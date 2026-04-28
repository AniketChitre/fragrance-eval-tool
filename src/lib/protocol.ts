export function summariseProtocol(text: string): string {
  if (!text || !text.trim()) return "";
  const lines = text.split(/\r?\n/);
  const get = (re: RegExp): string | null => {
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  const title = (lines.find((l) => l.trim().length > 0) ?? "").trim();
  const ambientTemp = get(/Ambient temperature:\s*(.+)/i);
  const humidity = get(/Humidity:\s*(.+)/i);
  const waterTemp = get(/Water temperature:\s*(.+)/i);
  const flow = get(/Flow rate:\s*(.+)/i);
  const dose = get(/Product dose:\s*(.+)/i);
  const showerRun = get(/Shower running time:\s*(.+)/i);
  const incubation = get(/Incubation:\s*(.+)/i);
  const evalDist = get(/Evaluation distance:\s*(.+)/i);
  const scaleLine =
    get(/Linear scale:\s*(.+)/i) ?? get(/Scale.*?:\s*(.+)/i);
  const reference = get(/Reference:\s*(.+)/i);
  const lowControl = get(/Low control:\s*(.+)/i);
  const highControl = get(/High control:\s*(.+)/i);

  const lines_out: string[] = [];
  if (title) lines_out.push(title);
  lines_out.push("");
  lines_out.push("Purpose: comparative bloom intensity assessment in fragrance booth.");
  lines_out.push("");
  lines_out.push("Conditions:");
  if (ambientTemp) lines_out.push(`- Ambient temperature: ${ambientTemp}`);
  if (humidity) lines_out.push(`- Humidity: ${humidity}`);
  if (waterTemp) lines_out.push(`- Water temperature: ${waterTemp}`);
  if (flow) lines_out.push(`- Flow rate: ${flow}`);
  lines_out.push("");
  lines_out.push("Sample and timing:");
  if (dose) lines_out.push(`- Product dose: ${dose}`);
  if (showerRun) lines_out.push(`- Shower run: ${showerRun}`);
  if (incubation) lines_out.push(`- Incubation: ${incubation}`);
  if (evalDist) lines_out.push(`- Evaluation distance: ${evalDist}`);
  lines_out.push("");
  lines_out.push("Scale:");
  if (scaleLine) lines_out.push(`- Linear scale: ${scaleLine}`);
  if (reference) lines_out.push(`- Reference intensity: ${reference}`);
  if (lowControl) lines_out.push(`- Low control: ${lowControl}`);
  if (highControl) lines_out.push(`- High control: ${highControl}`);
  lines_out.push("");
  lines_out.push("Key steps:");
  lines_out.push("1. Mix sample, cover, equilibrate 15 minutes.");
  lines_out.push("2. Pre-condition booth: shower 37 C for 3 minutes.");
  lines_out.push("3. Lather under shower for 1 minute.");
  lines_out.push("4. Wait 1 minute for bloom, then score 0-10.");
  lines_out.push("");
  lines_out.push("Controls: panellists must avoid personal fragrance; ventilate 1 hour between samples.");
  return lines_out.join("\n");
}
