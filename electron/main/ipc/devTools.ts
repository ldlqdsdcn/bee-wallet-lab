import { IPC } from '../../../shared/ipc'
import type { DevConvertInput, DevConvertResult, DevHashInput, DevHashResult, DevJsonResult } from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { convertDevBytes, formatDevJson, hashDevBytes } from '../devTools/service'

export function registerDevToolsIpc(): void {
  handle<{ value: string }, DevJsonResult>(IPC.devToolsJson, (arg) => formatDevJson(requireString(arg?.value, 'value')))

  handle<DevConvertInput, DevConvertResult>(IPC.devToolsConvert, (arg) =>
    convertDevBytes(requireObject<DevConvertInput>(arg)),
  )

  handle<DevHashInput, DevHashResult>(IPC.devToolsHash, (arg) => hashDevBytes(requireObject<DevHashInput>(arg)))
}
