"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Header } from "@/components/header"
import { Hero } from "@/components/hero"
import { ConfigForm } from "@/components/config-form"
import { PositionCard } from "@/components/position-card"
import type { Position, LogEntry } from "@/types"

export default function Dashboard() {
  const [positions, setPositions] = useState<Position[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const handleMintPosition = (config: {
    tokenPair: string
    width: number
    drift: number
    initialCenter: number
  }) => {
    const newPosition: Position = {
      id: positions.length + 1,
      tokenPair: config.tokenPair,
      width: config.width,
      drift: config.drift,
      center: config.initialCenter,
      currentTick: config.initialCenter,
      priceHistory: [
        { time: Date.now(), tick: config.initialCenter, center: config.initialCenter, width: config.width },
      ],
      isActive: true,
    }

    setPositions((prev) => [...prev, newPosition])

    const logEntry: LogEntry = {
      id: Date.now(),
      positionId: newPosition.id,
      time: new Date().toLocaleTimeString(),
      event: `Position minted with center ${config.initialCenter}, width ${config.width}, drift ${config.drift}`,
      type: "mint",
    }

    setLogs((prev) => [...prev, logEntry])
  }

  const handlePriceMove = (positionId: number, newTick: number) => {
    setPositions((prev) =>
      prev.map((position) => {
        if (position.id !== positionId) return position

        const updatedHistory = [
          ...position.priceHistory,
          { time: Date.now(), tick: newTick, center: position.center, width: position.width },
        ]

        // Check if rebalance is needed
        const driftDistance = Math.abs(newTick - position.center)
        let newCenter = position.center
        let shouldRebalance = false

        if (driftDistance > position.drift) {
          newCenter = newTick
          shouldRebalance = true

          const logEntry: LogEntry = {
            id: Date.now(),
            positionId: position.id,
            time: new Date().toLocaleTimeString(),
            event: `Rebalanced to center ${newCenter} (price moved to ${newTick})`,
            type: "rebalance",
          }

          setLogs((prev) => [...prev, logEntry])
        }

        return {
          ...position,
          currentTick: newTick,
          center: newCenter,
          priceHistory: shouldRebalance
            ? [
                ...updatedHistory.slice(0, -1),
                { time: Date.now(), tick: newTick, center: newCenter, width: position.width },
              ]
            : updatedHistory,
        }
      }),
    )
  }

  const handleMigration = (positionId: number) => {
    const logEntry: LogEntry = {
      id: Date.now(),
      positionId,
      time: new Date().toLocaleTimeString(),
      event: "Mock migrated to Arbitrum (Goerli testnet)",
      type: "migration",
    }

    setLogs((prev) => [...prev, logEntry])
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <Hero />

        <div className="grid gap-8 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <ConfigForm onMint={handleMintPosition} />
          </motion.div>

          <div className="space-y-6">
            {positions.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-12 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl border border-blue-200"
              >
                <div className="text-blue-600 text-lg font-semibold mb-2">No Active Positions</div>
                <div className="text-blue-500">Create your first LP position to start trading</div>
              </motion.div>
            )}

            {positions.map((position, index) => (
              <motion.div
                key={position.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: index * 0.15 }}
                className="relative"
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 rounded-2xl blur opacity-25"></div>
                <div className="relative">
                  <PositionCard
                    position={position}
                    logs={logs.filter((log) => log.positionId === position.id)}
                    onPriceMove={handlePriceMove}
                    onMigration={handleMigration}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
