//! sp-harness: run one Silent Partner tool the way IronClaw would, for local tests.
//! (Adapted from Scope's harness, github.com/amityadav0/scope.)
//!
//!   sp-harness <tool-id> '<params json>' [--manifest PATH] [--wasm PATH]
//!
//! What it mimics from the IronClaw host:
//! - dispatch by `context.capability_id`;
//! - per-tool egress allowlist from `manifest.toml` (`network_targets`),
//!   everything else is `network-denied` with `request-sent = false`;
//! - `max_egress_bytes` on response bodies;
//! - `IRONCLAW_REBORN_TEST_HTTP_REWRITE_MAP="host=ip:port,…"`, which sends an
//!   allowlisted host to a local address over plain HTTP.
//!
//! Every request (allowed or denied) is logged to stderr as an `EGRESS` line,
//! and the run ends with `egress_calls=N denied=M`, so a test can assert that
//! a refusal never left the machine. The tool's response goes to stdout.
//!
//! Workspace reads come from `SP_HARNESS_WORKSPACE` (a directory), if set.
//! It is not IronClaw: no secrets, no tool-invoke, no private-IP policy beyond
//! the allowlist.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use wasmtime::component::{bindgen, Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

bindgen!({ world: "sandboxed-tool", path: "../wit/tool.wit" });

use exports::near::agent::tool::{Request, Response};
use near::agent::host::{HttpErrorKind, HttpFailure, HttpResponse, LogLevel};

#[derive(Deserialize)]
struct Manifest {
    tools: Vec<ToolEntry>,
}
#[derive(Deserialize)]
struct ToolEntry {
    id: String,
    #[serde(default)]
    network_targets: Vec<Target>,
    #[serde(default)]
    max_egress_bytes: Option<usize>,
}
#[derive(Deserialize, Clone)]
struct Target {
    scheme: String,
    host_pattern: String,
}

struct Host {
    wasi: WasiCtx,
    table: ResourceTable,
    targets: Vec<Target>,
    max_bytes: usize,
    rewrite: HashMap<String, String>,
    calls: u32,
    denied: u32,
}

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView { ctx: &mut self.wasi, table: &mut self.table }
    }
}

fn split_url(url: &str) -> Option<(&str, &str, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    Some((scheme, host, path))
}

fn host_matches(pattern: &str, host: &str) -> bool {
    match pattern.strip_prefix("*.") {
        Some(suffix) => host.ends_with(&format!(".{suffix}")),
        None => pattern == host,
    }
}

fn denied(code: &str, message: String) -> HttpFailure {
    HttpFailure { kind: HttpErrorKind::NetworkDenied, code: Some(code.into()), message: Some(message), request_sent: false }
}

impl near::agent::host::Host for Host {
    fn log(&mut self, level: LogLevel, message: String) {
        eprintln!("GUEST {level:?}: {message}");
    }
    fn now_millis(&mut self) -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
    }
    fn workspace_read(&mut self, path: String) -> Option<String> {
        if path.starts_with('/') || path.contains("..") {
            return None;
        }
        let dir = std::env::var("SP_HARNESS_WORKSPACE").ok()?;
        std::fs::read_to_string(std::path::Path::new(&dir).join(path)).ok()
    }
    fn http_request(&mut self, method: String, url: String, headers_json: String, body: Option<Vec<u8>>, timeout_ms: Option<u32>) -> Result<HttpResponse, HttpFailure> {
        let Some((scheme, host, path)) = split_url(&url) else {
            self.denied += 1;
            eprintln!("EGRESS DENIED {method} {url} (unparseable)");
            return Err(denied("bad_url", url));
        };
        if !self.targets.iter().any(|t| t.scheme == scheme && host_matches(&t.host_pattern, host)) {
            self.denied += 1;
            eprintln!("EGRESS DENIED {method} {url} (not in this tool's network_targets)");
            return Err(denied("not_allowlisted", format!("{scheme}://{host} is not allowlisted for this tool")));
        }
        let target = match self.rewrite.get(host) {
            Some(addr) => format!("http://{addr}{path}"),
            None => url.clone(),
        };
        self.calls += 1;
        let headers: HashMap<String, String> = serde_json::from_str(&headers_json).unwrap_or_default();
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_millis(u64::from(timeout_ms.unwrap_or(20_000)))))
            .build()
            .into();
        let mut req = ureq::http::Request::builder().method(method.as_str()).uri(&target);
        for (k, v) in &headers {
            req = req.header(k, v);
        }
        let result = req
            .body(body.unwrap_or_default())
            .map_err(|e| e.to_string())
            .and_then(|r| agent.run(r).map_err(|e| e.to_string()));
        match result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let bytes = resp.into_body().read_to_vec().unwrap_or_default();
                let via = if target != url { format!(" via {target}") } else { String::new() };
                eprintln!("EGRESS {method} {url}{via} -> {status} ({} bytes)", bytes.len());
                if bytes.len() > self.max_bytes {
                    return Err(HttpFailure { kind: HttpErrorKind::OutputTooLarge, code: Some("max_egress_bytes".into()), message: None, request_sent: true });
                }
                Ok(HttpResponse { status, headers_json: "{}".into(), body: bytes })
            }
            Err(e) => {
                eprintln!("EGRESS {method} {url} -> transport error: {e}");
                Err(HttpFailure { kind: HttpErrorKind::OperationFailed, code: Some("transport".into()), message: Some(e), request_sent: true })
            }
        }
    }
    fn tool_invoke(&mut self, alias: String, _params_json: String) -> Result<String, String> {
        Err(format!("tool-invoke({alias}) is not available in the harness"))
    }
    fn secret_exists(&mut self, _name: String) -> bool {
        false
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str, default: &str| -> String {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| default.to_string())
    };
    let (Some(tool_id), Some(params)) = (args.get(1), args.get(2)) else {
        return Err(anyhow!("usage: sp-harness <tool-id> '<params json>' [--manifest PATH] [--wasm PATH]"));
    };
    let manifest_path = flag("--manifest", "../manifest.toml");
    let wasm_path = flag("--wasm", "../wasm/silent_partner_tool.wasm");

    let manifest: Manifest = toml::from_str(&std::fs::read_to_string(&manifest_path).with_context(|| format!("read {manifest_path}"))?)?;
    let tool = manifest.tools.iter().find(|t| &t.id == tool_id).ok_or_else(|| anyhow!("{tool_id} is not in {manifest_path}"))?;
    let rewrite: HashMap<String, String> = std::env::var("IRONCLAW_REBORN_TEST_HTTP_REWRITE_MAP")
        .unwrap_or_default()
        .split(',')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();

    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;
    let component = Component::from_file(&engine, &wasm_path).map_err(|e| anyhow!("load {wasm_path}: {e}"))?;
    let mut linker: Linker<Host> = Linker::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
    SandboxedTool::add_to_linker::<Host, HasSelf<Host>>(&mut linker, |h| h)?;

    let host = Host {
        wasi: WasiCtxBuilder::new().inherit_stderr().build(),
        table: ResourceTable::new(),
        targets: tool.network_targets.clone(),
        max_bytes: tool.max_egress_bytes.unwrap_or(262_144),
        rewrite,
        calls: 0,
        denied: 0,
    };
    let mut store = Store::new(&engine, host);
    let instance = SandboxedTool::instantiate(&mut store, &component, &linker)?;
    let req = Request { params: params.clone(), context: Some(serde_json::json!({ "capability_id": tool_id }).to_string()) };
    let resp = instance.near_agent_tool().call_execute(&mut store, &req)?;
    let (calls, denied) = (store.data().calls, store.data().denied);
    match resp {
        Response::Success(s) => println!("{s}"),
        Response::Failure(f) => println!("{}", serde_json::json!({ "failure": { "kind": format!("{:?}", f.kind), "code": f.code, "message": f.message } })),
    }
    eprintln!("egress_calls={calls} denied={denied}");
    Ok(())
}
