import { createContext, useContext } from 'react'
import { tr, type T } from './i18n'

export const TContext = createContext<T>((s, ...a) => tr('en', s, ...a))
export const useT = () => useContext(TContext)
