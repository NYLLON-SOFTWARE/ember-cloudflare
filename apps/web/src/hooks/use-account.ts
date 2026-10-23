import { createContext, useContext } from "react";
import type { Account } from "@ember/protocol";

/**
 * The workspace as every page shows it: as the app loaded it, or as the workspace socket or a change
 * made here last said it is. Until it's known, it's as ember-rust's is before first run.
 */
export const AccountContext = createContext<Account>({ name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null });

export const useAccount = () => useContext(AccountContext);
