import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import { isTypeScriptSource } from "./util.js";

const LAYER_PATTERNS: { layer: string; matcher: RegExp }[] = [
  { layer: "client", matcher: /(^|\/)(client|src\/client|frontend|ui|components|pages)\// },
  { layer: "server", matcher: /(^|\/)(server|src\/server|api|routes|controllers)\// },
  { layer: "shared", matcher: /(^|\/)(shared|common|lib|core|state|validation|validators|schemas?)\// },
  { layer: "service", matcher: /(^|\/)(services?|business|domain)\// },
  { layer: "data", matcher: /(^|\/)(stores?|repositories|repository|persistence)\// },
  { layer: "hooks", matcher: /(^|\/)hooks?\// },
  { layer: "cli", matcher: /(^|\/)cli\.tsx?$|(^|\/)bin\// },
  { layer: "stream", matcher: /(^|\/)stream\.tsx?$|(^|\/)streams?\// },
  { layer: "batch", matcher: /(^|\/)batch\.tsx?$|(^|\/)batches?\// },
];

export function d5CrossLayerWiring(loaded: LoadedSkeleton): DimScore {
  const layers = new Set<string>();
  const sharedFiles: string[] = [];

  for (const path of Object.keys(loaded.files)) {
    if (!isTypeScriptSource(path)) continue;
    if (/__tests__\//.test(path)) continue;
    for (const { layer, matcher } of LAYER_PATTERNS) {
      if (matcher.test(path)) {
        layers.add(layer);
        if (layer === "shared") sharedFiles.push(path);
      }
    }
  }

  const layerCount = layers.size;
  const hasShared = layers.has("shared");

  let score: 1 | 2 | 3 | 4 | 5;
  if (layerCount <= 1) score = 1;
  else if (layerCount === 2 && !hasShared) score = 3;
  else if (layerCount === 2 && hasShared) score = 4;
  else if (layerCount >= 3 && hasShared) score = 5;
  else score = 4;

  return {
    dim: "D5_crossLayerWiring",
    score,
    evidence: {
      layers: [...layers],
      layerCount,
      hasSharedContract: hasShared ? "yes" : "no",
      sharedFiles,
    },
  };
}
