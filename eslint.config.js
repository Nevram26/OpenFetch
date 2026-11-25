import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['out/', 'dist/', 'resources/binaries/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended
])
