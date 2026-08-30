import { describe, expect, it } from "vitest"
import { disambiguate } from "./names"
import type { GraphNode, NodeType } from "../types"

function file(id: string): GraphNode {
  return {
    id,
    label: id
      .split("/")
      .pop()!
      .replace(/\.tsx?$/, ""),
    type: "module" as NodeType,
    file: id,
    line: 1,
    cluster: id.split("/")[0] ?? "src",
  }
}

describe("naming files on screen", () => {
  it("leaves a name alone when nothing else answers to it", () => {
    const names = disambiguate([file("features/bookings/handleCancelBooking.ts")])
    expect(names.get("features/bookings/handleCancelBooking.ts")).toBe("handleCancelBooking")
  })

  it("qualifies the two that clash, and only them", () => {
    // cal.com keeps a zod-utils in two places; the neighbourhood around a
    // booking draws both, and `zod-utils` twice tells the reader nothing
    const names = disambiguate([
      file("prisma/zod-utils.ts"),
      file("app-store/zod-utils.ts"),
      file("lib/logger.ts"),
    ])
    expect(names.get("prisma/zod-utils.ts")).toBe("prisma/zod-utils")
    expect(names.get("app-store/zod-utils.ts")).toBe("app-store/zod-utils")
    expect(names.get("lib/logger.ts")).toBe("logger")
  })

  it("takes only as much path as it needs", () => {
    // one folder apart is enough here; spelling the whole path would be noise
    const names = disambiguate([
      file("packages/features/a/PaymentService.ts"),
      file("packages/features/b/PaymentService.ts"),
    ])
    expect(names.get("packages/features/a/PaymentService.ts")).toBe("a/PaymentService")
  })

  it("keeps going up while a single folder still leaves them alike", () => {
    const names = disambiguate([
      file("app-store/stripe/lib/PaymentService.ts"),
      file("app-store/alby/lib/PaymentService.ts"),
    ])
    expect(names.get("app-store/stripe/lib/PaymentService.ts")).toBe("stripe/lib/PaymentService")
    expect(names.get("app-store/alby/lib/PaymentService.ts")).toBe("alby/lib/PaymentService")
  })

  it("separates four of a kind", () => {
    // every payment integration carries one, and a neighbourhood can hold
    // several at once
    const ids = ["stripe", "alby", "paypal", "hitpay"].map((app) =>
      file(`app-store/${app}/PaymentService.ts`),
    )
    expect(new Set(disambiguate(ids).values()).size).toBe(4)
  })

  it("gives up quietly on files that differ nowhere visible", () => {
    // same name, same path: nothing left to say, and no reason to loop for ever
    const twins = [file("a/x.ts"), { ...file("a/x.ts"), id: "a/x.ts" }]
    expect(() => disambiguate(twins)).not.toThrow()
  })

  it("handles a file sitting at the root", () => {
    const names = disambiguate([file("index.ts"), file("lib/index.ts")])
    expect(names.get("lib/index.ts")).toBe("lib/index")
    expect(names.get("index.ts")).toBe("index")
  })
})
