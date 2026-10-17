import { Converter } from "opencc-js";

/** Simplified -> Traditional (Hong Kong standard). */
export const hansToHk = Converter({ from: "cn", to: "hk" });
/** Simplified -> Traditional (Taiwan standard, with phrase conversion). */
export const hansToTw = Converter({ from: "cn", to: "twp" });
/** Any Traditional variant -> Simplified. */
export const hantToHans = Converter({ from: "t", to: "cn" });
