"use client"

import type React from "react"
import { WagmiProvider, createConfig, http } from "wagmi"
import { sepolia, mainnet } from "wagmi/chains"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { injected } from "wagmi/connectors"

const config = createConfig({
  chains: [sepolia, mainnet],
  connectors: [
    injected({
      target: "metaMask",
    }),
  ],
  transports: {
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
})

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
