// Signed track-record proofs, added by pull request after a trader creates one on
// /track/. Each one is re-verified in the visitor's browser before it is shown;
// an entry that doesn't verify is ignored. Empty until a trader opts in.
import type { TrackProof } from "./trackrecord";

export const TRACK_PROOFS: TrackProof[] = [];
