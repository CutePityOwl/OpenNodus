#!/usr/bin/env bun

import { Server } from "../src/server/server"

console.log(JSON.stringify(await Server.openapi(), null, 2))
