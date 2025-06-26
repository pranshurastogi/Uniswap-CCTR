export interface Position {
  id: number
  tokenPair: string
  width: number
  drift: number
  center: number
  currentTick: number
  priceHistory: PricePoint[]
  isActive: boolean
}

export interface PricePoint {
  time: number
  tick: number
  center: number
  width: number
}

export interface LogEntry {
  id: number
  positionId: number
  time: string
  event: string
  type: "mint" | "rebalance" | "migration"
}
