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

export type EndangeredFishRow ={
  id: string;
  image_url: string;
  created_at: string;
  species: string;
  population_history: { count: number; month: string }[];
  fun_fact: string;
  why_care: string;
}

/* ------------------------------ history_of_endangered_fish ---------------------------------- */

// this will be static information, unless new fish are added into the database when:
// 1. more endangered fish are discovered, or
// 2. the population of an existing endangered fish is updated
// 3. the endangered fish is removed from the database (e.g. if it goes extinct)

// For now, in these cases, a refresh is needed to update the aquarium with the new information.
// TODO: Implement a subscription to the history_of_endangered_fish table to automatically update the aquarium when new fish are added or existing fish are updated/removed.

export async function getExistingEndangeredFish(): Promise<EndangeredFishRow[]> {
  const { data, error } = await supabase
    .from("history_of_endangered_fish")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to fetch existing endangered fish:", error);
    return [];
  }
  return data ?? [];
}


/* ------------------------------ fish table ---------------------------------- */

// fish already in the DB when the tank first loads
export async function getExistingFish(): Promise<FishRow[]> {
  const { data, error } = await supabase
    .from("fish")
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
    .channel("fish_changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "fish" },
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
    .from("fish")
    .insert({ image_url: imageUrl, outline })
    .select()
    .single();

  if (error) {
    console.error("Failed to insert new fish:", error);
    return null;
  }
  return data;
}