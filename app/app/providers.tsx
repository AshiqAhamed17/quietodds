"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { config } from "@/lib/wagmi";
import { PrivateAccountProvider } from "@/components/PrivateAccount";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <PrivateAccountProvider>{children}</PrivateAccountProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
