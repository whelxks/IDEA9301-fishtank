export type FinishedFish = {
  imageUrl: string;
  outlineId: string;
  label: string;
};

const KEY = "finishedFish";

// sessionStorage keeps /completed working after a refresh.
export function saveFinishedFish(fish: FinishedFish) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(fish));
  } catch {
    /* ignore */
  }
}

export function loadFinishedFish(): FinishedFish | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FinishedFish) : null;
  } catch {
    return null;
  }
}

export function clearFinishedFish() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}