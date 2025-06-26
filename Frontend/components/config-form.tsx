"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ConfigFormProps {
  onMint: (config: {
    tokenPair: string
    width: number
    drift: number
    initialCenter: number
  }) => void
}

const TOKEN_PAIRS = ["WETH/USDC", "WETH/USDT", "WBTC/USDC", "UNI/WETH", "LINK/WETH"]

export function ConfigForm({ onMint }: ConfigFormProps) {
  const [tokenPair, setTokenPair] = useState("")
  const [width, setWidth] = useState("")
  const [drift, setDrift] = useState("")
  const [initialCenter, setInitialCenter] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!tokenPair || !width || !drift || !initialCenter) {
      return
    }

    onMint({
      tokenPair,
      width: Number.parseInt(width),
      drift: Number.parseInt(drift),
      initialCenter: Number.parseInt(initialCenter),
    })

    // Reset form
    setTokenPair("")
    setWidth("")
    setDrift("")
    setInitialCenter("")
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Quick Config Form</CardTitle>
        <CardDescription>Configure your LP position parameters to start simulation</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tokenPair">Token Pair</Label>
            <Select value={tokenPair} onValueChange={setTokenPair}>
              <SelectTrigger>
                <SelectValue placeholder="Select token pair" />
              </SelectTrigger>
              <SelectContent>
                {TOKEN_PAIRS.map((pair) => (
                  <SelectItem key={pair} value={pair}>
                    {pair}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="width">Width (ticks)</Label>
              <Input
                id="width"
                type="number"
                placeholder="200"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="drift">Drift (ticks)</Label>
              <Input
                id="drift"
                type="number"
                placeholder="50"
                value={drift}
                onChange={(e) => setDrift(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="initialCenter">Initial Center</Label>
              <Input
                id="initialCenter"
                type="number"
                placeholder="2000"
                value={initialCenter}
                onChange={(e) => setInitialCenter(e.target.value)}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
            disabled={!tokenPair || !width || !drift || !initialCenter}
          >
            Mint Simulation
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
