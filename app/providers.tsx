"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@/styles/wallet-adapter.css";

/**
 * An empty `wallets` array is intentional: every current Solana wallet
 * registers itself through the Wallet Standard, so they are discovered
 * automatically and there is no per-wallet adapter list to keep up to date.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://api.mainnet-beta.solana.com",
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
