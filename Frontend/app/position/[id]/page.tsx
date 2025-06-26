"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Header } from "@/components/header"
import { PositionCard } from "@/components/position-card"
import type { Position, LogEntry } from "@/types"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function PositionDetail() {
  const params = useParams()
  const [position, setPosition] = useState<Position | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])

  // In a real app, this would fetch from an API or global state
  useEffect(() => {
    // Mock position data for demo
    const mockPosition: Position = {
      id: Number.parseInt(params.id as string),
      tokenPair: "WETH/USDC",
      width: 200,
      drift: 50,
      center: 2000,
      currentTick: 2025,
      priceHistory: [
        { time: Date.now() - 300000, tick: 2000, center: 2000, width: 200 },
        { time: Date.now() - 200000, tick: 2025, center: 2000, width: 200 },
        { time: Date.now() - 100000, tick: 2050, center: 2050, width: 200 },
        { time: Date.now(), tick: 2025, center: 2050, width: 200 },
      ],
      isActive: true,
    }

    const mockLogs: LogEntry[] = [
      {
        id: 1,
        positionId: mockPosition.id,
        time: "10:30:15",
        event: "Position minted with center 2000, width 200, drift 50",
        type: "mint",
      },
      {
        id: 2,
        positionId: mockPosition.id,
        time: "10:35:22",
        event: "Rebalanced to center 2050 (price moved to 2050)",
        type: "rebalance",
      },
    ]

    setPosition(mockPosition)
    setLogs(mockLogs)
  }, [params.id])

  const handlePriceMove = (positionId: number, newTick: number) => {
    if (!position) return

    const updatedHistory = [
      ...position.priceHistory,
      { time: Date.now(), tick: newTick, center: position.center, width: position.width },
    ]

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

    setPosition({
      ...position,
      currentTick: newTick,
      center: newCenter,
      priceHistory: shouldRebalance
        ? [
            ...updatedHistory.slice(0, -1),
            { time: Date.now(), tick: newTick, center: newCenter, width: position.width },
          ]
        : updatedHistory,
    })
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

  if (!position) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading position...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-bold">Position #{position.id}</h1>
          <p className="text-gray-600">Detailed view of your LP position</p>
        </div>

        <PositionCard position={position} logs={logs} onPriceMove={handlePriceMove} onMigration={handleMigration} />
      </main>
    </div>
  )
}
