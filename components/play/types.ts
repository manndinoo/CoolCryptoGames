export type GameSummary = {
  slug: string;
  title: string;
  status: "playable" | "coming-soon";
  /** Optional art shown behind the play control. */
  cover?: string | null;
  /** Whether the server can replay this game's runs and vouch for a score. */
  ranked: boolean;
};
