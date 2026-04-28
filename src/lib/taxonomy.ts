export interface GrandFamily {
  name: string;
  color: string;
  subfamilies: string[];
}

export const GRAND_FAMILIES: GrandFamily[] = [
  { name: "Floral", color: "#e8a0c0", subfamilies: ["Mimosic", "Muguet", "Rosy", "Violetty/Orris", "White Floral", "Floral Others"] },
  { name: "Citrus", color: "#f0d040", subfamilies: ["Citrus Cologne", "Grapefruity", "Lemony/Limey", "Orange/Mandarin", "Citrus Others"] },
  { name: "Green", color: "#78c050", subfamilies: ["Cucumbery/Violet Leaf", "Grassy", "Green Pineappley", "Green Stemmy", "Green Others"] },
  { name: "Fruity", color: "#e06858", subfamilies: ["Appley/Peary", "Berries", "Cassis", "Cherry/Almondy", "Peachy", "Yeasty/Fermented", "Tropical", "Fruity Others"] },
  { name: "Sweet/Balsamic", color: "#a080d0", subfamilies: ["Balsamic", "Coumarinic", "Gourmand", "Lactonic", "Powdery", "Sweet"] },
  { name: "Woody", color: "#c09060", subfamilies: ["Cedarwoody", "Driftwoody", "Earthy", "Liquor-like", "Nutty", "Oudy", "Resinous/Piney", "Roasted", "Sandalwoody", "Smoldering", "Spicy", "Woody Others"] },
  { name: "Herbal", color: "#90c068", subfamilies: ["Lavendery", "Minty", "Anisic", "Herbal Others"] },
  { name: "Animalic", color: "#c07870", subfamilies: ["Barny/Fecal", "Hairy", "Leathery", "Musky", "Skin-like", "Animalic Others"] },
  { name: "Mineral", color: "#60b8c8", subfamilies: ["Aldehydic", "Marine", "Metallic", "Ozonic/Electric", "Sulfury", "Wet", "Mineral Others"] },
  { name: "Soulful", color: "#e0a058", subfamilies: ["Greasy", "Starchy", "Soulful Others"] },
  { name: "Industrial", color: "#8090a8", subfamilies: ["Chemical/Solventy", "Industrial/Mechanical Others"] },
];

export const SENSATIONS: string[] = [
  "Bitter", "Clean", "Cold/Crisp/Fresh", "Dirty", "Dry", "Dull", "Energizing", "Fluo/Neon",
  "Light", "Mild", "Narcotic", "Old/Aged/Mature", "Pastel", "Scratchy", "Warm/Rich", "Zesty",
  "Bland", "Cooling", "Delicate", "Dense/Heavy/Pesante", "Fatty", "Fibery/Textural", "Fizzy",
  "Flat", "Grainy/Lumpy", "Granular", "Hard/Rough/Spiky", "Harsh", "Heaty/Hot", "Hollow",
  "Juicy/Pulpy/Fleshy", "Opaque", "Polished/Silky", "Round", "Sandy", "Shiny/Bright", "Smooth",
  "Soft/Velvety", "Steamy", "Strong/Pungent/Sharp", "Tart", "Transparent/Sheer",
];

export interface DetectedTerm {
  term: string;
  family: string;
  color: string;
}

export function buildTermIndex(): Map<string, { family: string; color: string }> {
  const map = new Map<string, { family: string; color: string }>();
  for (const gf of GRAND_FAMILIES) {
    const meta = { family: gf.name, color: gf.color };
    map.set(gf.name.toLowerCase(), meta);
    for (const sf of gf.subfamilies) {
      map.set(sf.toLowerCase(), meta);
    }
  }
  const sensationMeta = { family: "Sensation", color: "#888888" };
  for (const s of SENSATIONS) {
    map.set(s.toLowerCase(), sensationMeta);
  }
  return map;
}

export function detectDescriptors(text: string, index: Map<string, { family: string; color: string }>): DetectedTerm[] {
  if (!text.trim()) return [];
  const lower = text.toLowerCase();
  const found: DetectedTerm[] = [];
  for (const [term, meta] of index.entries()) {
    // whole-word match to avoid false positives (e.g. "rosy" inside "generosity")
    const re = new RegExp(`(?<![a-z])${term.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![a-z])`, "i");
    if (re.test(lower)) {
      found.push({ term, family: meta.family, color: meta.color });
    }
  }
  return found.sort((a, b) => a.family.localeCompare(b.family) || a.term.localeCompare(b.term));
}

export function getFamilyColor(familyName: string): string {
  return GRAND_FAMILIES.find((g) => g.name === familyName)?.color ?? "#888888";
}
