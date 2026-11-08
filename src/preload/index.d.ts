import { RosettaAPI } from '../shared/types'

declare global {
  interface Window {
    rosetta: RosettaAPI
  }
}
