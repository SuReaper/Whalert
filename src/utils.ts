// Fear and Greed Index part
interface FearGreedData {
  value: string;
  value_classification: string;
  timestamp: string;
}

interface FearGreedResponse {
  data: FearGreedData[];
}

export async function getFearGreed() {
  const response = await fetch('https://api.alternative.me/fng/?limit=2');
  const data = await response.json() as FearGreedResponse;
  return data.data[0];
}

export function formatFearGreed(fng: FearGreedData): string {
  return `\n\nFear & Greed Index: ${fng.value}/100 (${fng.value_classification})`;
}
