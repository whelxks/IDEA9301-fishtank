// app/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type FishRow = {
  id: string;
  image_url: string;
  outline: string | null;
  created_at: string;
};

// fish already in the DB when the tank first loads
export async function getExistingFish(): Promise<FishRow[]> {
  const { data, error } = await supabase
    .from("fish_uploads")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to fetch existing fish:", error);
    return [];
  }
  return data ?? [];
}

// fires `onInsert` every time a new row lands, after this is called
export function subscribeToNewFish(onInsert: (row: FishRow) => void) {
  const channel = supabase
    .channel("fish_uploads_changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "fish_uploads" },
      (payload) => onInsert(payload.new as FishRow)
    )
    .subscribe();

  return channel; // caller unsubscribes with channel.unsubscribe()
}

// insert a new fish row; returns the inserted row, or null on failure
export async function addNewFish(
  imageUrl: string,
  outline: string | null = null
): Promise<FishRow | null> {
  const { data, error } = await supabase
    .from("fish_uploads")
    .insert({ image_url: imageUrl, outline })
    .select()
    .single();

  if (error) {
    console.error("Failed to insert new fish:", error);
    return null;
  }
  return data;
}