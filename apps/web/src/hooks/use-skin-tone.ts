import { createContext, useContext } from "react";
import type { Me, SkinTone } from "@ember/protocol";

/** The skin tone whoever's signed in chose on their profile for emoji: the default until it's known. */
export const SkinToneContext = createContext<SkinTone>(0);

export const useSkinTone = () => useContext(SkinToneContext);

/** `me` with the skin tone `skinTone`, left out at the default, as the server leaves it out. */
export function withSkinToneOf(me: Me, skinTone: SkinTone): Me {
  const { skinTone: _, ...rest } = me;
  return skinTone === 0 ? rest : { ...rest, skinTone };
}
