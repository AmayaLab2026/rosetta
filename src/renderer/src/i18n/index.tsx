import React, { createContext, useContext, useState } from 'react'
import zh from './locales/zh.json'
import en from './locales/en.json'

export type Language = 'zh' | 'en'

export const translations = {
  zh,
  en
}

export type TranslationSchema = typeof zh

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: TranslationSchema
}

const I18nContext = createContext<I18nContextType>({
  language: 'zh',
  setLanguage: () => {},
  t: zh
})

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('rosetta_lang') as Language
      if (saved === 'zh' || saved === 'en') return saved
    } catch (e) {
      // ignore
    }
    return 'zh' // Default to Chinese
  })

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    try {
      localStorage.setItem('rosetta_lang', lang)
    } catch (e) {
      // ignore
    }
  }

  const t = translations[language]

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => useContext(I18nContext)
