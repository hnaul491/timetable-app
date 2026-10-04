import { createContext, useContext } from "react";

/** Lets small floating controls open the search palette that Layout owns. */
export const OpenSearchContext = createContext<() => void>(() => {});
export const useOpenSearch = () => useContext(OpenSearchContext);
