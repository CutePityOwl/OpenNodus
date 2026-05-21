import { BusEvent } from "@/bus/bus-event"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"

const DEFAULT_TOAST_DURATION = 5000

export const ServerEvent = {
  ToastShow: BusEvent.define(
    "server.toast.show",
    Schema.Struct({
      title: Schema.optional(Schema.String),
      message: Schema.String,
      variant: Schema.Literals(["info", "success", "warning", "error"]),
      duration: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_TOAST_DURATION))).annotate({
        description: "Duration in milliseconds",
      }),
    }),
  ),
}
