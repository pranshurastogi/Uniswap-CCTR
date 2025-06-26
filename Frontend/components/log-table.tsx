import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import type { LogEntry } from "@/types"

interface LogTableProps {
  entries: LogEntry[]
}

export function LogTable({ entries }: LogTableProps) {
  const getEventTypeBadge = (type: string) => {
    switch (type) {
      case "mint":
        return <Badge variant="default">Mint</Badge>
      case "rebalance":
        return <Badge variant="secondary">Rebalance</Badge>
      case "migration":
        return (
          <Badge variant="outline" className="border-orange-200 text-orange-700">
            Migration
          </Badge>
        )
      default:
        return <Badge variant="outline">Event</Badge>
    }
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No events yet. Mint a position or simulate price movements to see activity.
      </div>
    )
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Event</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-sm">{entry.time}</TableCell>
                <TableCell>{getEventTypeBadge(entry.type)}</TableCell>
                <TableCell>{entry.event}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  )
}
