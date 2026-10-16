import { afterEach, describe, expect, it, vi } from "vitest"
import { PROBE_COMMAND, registerSpecCommands, SHOW_COMMAND } from "../src/commands.js"

interface RegisteredCommand {
  name: string
  execute: (input: { sessionID: string }) => Promise<unknown>
}

interface SentMessage {
  sessionID: string
  text: string
  description: string
  resume: boolean
}

function fakeContext() {
  const commands: Record<string, RegisteredCommand> = {}
  const sent: SentMessage[] = []
  // Provider/model listings stand in for live discovery: the no-pack branch
  // must return before either is reached, so a leak throws instead of probing.
  const network = {
    listModels: (): never => {
      throw new Error("model listing must not run when no pack is configured")
    },
    listProviders: (): never => {
      throw new Error("provider listing must not run when no pack is configured")
    },
  }
  const modelList = vi.spyOn(network, "listModels")
  const providerList = vi.spyOn(network, "listProviders")
  const ctx = {
    command: {
      transform: async (callback: (editor: unknown) => unknown) => {
        callback({
          add: (command: RegisteredCommand) => {
            commands[command.name] = command
          },
        })
      },
    },
    session: {
      synthetic: async (message: SentMessage) => {
        sent.push(message)
      },
    },
    model: { list: network.listModels },
    provider: { list: network.listProviders },
  }
  return { ctx, commands, sent, modelList, providerList }
}

function commandNamed(commands: Record<string, RegisteredCommand>, name: string): RegisteredCommand {
  const command = commands[name]
  if (!command) throw new Error(`command ${name} was not registered`)
  return command
}

describe("registerSpecCommands", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders no-pack guidance for both commands without touching the network", async () => {
    const { ctx, commands, sent, modelList, providerList } = fakeContext()
    await registerSpecCommands(ctx as never, () => ({ path: "C:/config/model-specs.json" }))

    await commandNamed(commands, SHOW_COMMAND).execute({ sessionID: "ses_test" })
    await commandNamed(commands, PROBE_COMMAND).execute({ sessionID: "ses_test" })

    expect(sent).toHaveLength(2)
    for (const message of sent) {
      expect(message.sessionID).toBe("ses_test")
      expect(message.text).toContain("no pack configured")
      expect(message.text).toContain("OPENCODE_MODEL_SPECS_PACK")
      expect(message.resume).toBe(false)
    }
    expect(modelList).not.toHaveBeenCalled()
    expect(providerList).not.toHaveBeenCalled()
  })

  it("renders an unusable pack error", async () => {
    const { ctx, commands, sent } = fakeContext()
    await registerSpecCommands(ctx as never, () => ({
      path: "C:/config/model-specs.json",
      error: "invalid JSON: boom",
    }))

    await commandNamed(commands, SHOW_COMMAND).execute({ sessionID: "ses_test" })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain("pack unusable")
    expect(sent[0]?.text).toContain("invalid JSON: boom")
    expect(sent[0]?.resume).toBe(false)
  })
})
