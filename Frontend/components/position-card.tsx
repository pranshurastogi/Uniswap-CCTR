"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { RangeChart } from "./range-chart"
import { LogTable } from "./log-table"
import type { Position, LogEntry } from "@/types"
import { ArrowUpDown, Zap } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"

interface PositionCardProps {
  position: Position
  logs: LogEntry[]
  onPriceMove: (positionId: number, newTick: number) => void
  onMigration: (positionId: number) => void
}

export function PositionCard({ position, logs, onPriceMove, onMigration }: PositionCardProps) {
  const [newTick, setNewTick] = useState("")

  const handlePriceMove = () => {
    if (!newTick) return
    onPriceMove(position.id, Number.parseInt(newTick))
    setNewTick("")
  }

  const handleMigration = () => {
    onMigration(position.id)
    toast.success("Mock migration to Arbitrum initiated!", {
      description: "Your position has been migrated to Arbitrum Sepolia testnet",
    })
  }

  const lowerBound = position.center - position.width / 2
  const upperBound = position.center + position.width / 2

  return (
    <Card className="shadow-lg rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Position #{position.id}
              <Badge variant={position.isActive ? "default" : "secondary"}>
                {position.isActive ? "Active" : "Inactive"}
              </Badge>
            </CardTitle>
            <CardDescription>{position.tokenPair}</CardDescription>
          </div>
          <Link href={`/position/${position.id}`}>
            <Button variant="outline" size="sm">
              View Details
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Position Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Current Center</div>
            <div className="text-lg font-semibold">{position.center}</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Width</div>
            <div className="text-lg font-semibold">{position.width}</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Drift</div>
            <div className="text-lg font-semibold">{position.drift}</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Current Tick</div>
            <div className="text-lg font-semibold">{position.currentTick}</div>
          </div>
        </div>

        {/* Range Info */}
        <div className="p-4 bg-blue-50 rounded-lg">
          <div className="text-sm text-blue-600 mb-2">Active Range</div>
          <div className="text-lg font-semibold text-blue-800">
            {lowerBound.toFixed(0)} ↔ {upperBound.toFixed(0)}
          </div>
        </div>

        {/* Range Chart */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Price Movement & Range</h3>
          <RangeChart data={position.priceHistory} />
        </div>

        {/* Price Simulation Controls */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Simulate Price Movement</h3>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Enter new tick"
              value={newTick}
              onChange={(e) => setNewTick(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handlePriceMove} disabled={!newTick}>
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Move Price
            </Button>
          </div>
        </div>

        {/* Migration Button */}
        <Button
          onClick={handleMigration}
          variant="outline"
          className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
        >
          <Zap className="mr-2 h-4 w-4" />
          Trigger Mock Migration
        </Button>

        {/* Event Log */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Event Log</h3>
          <LogTable entries={logs} />
        </div>
      </CardContent>
    </Card>
  )
}
