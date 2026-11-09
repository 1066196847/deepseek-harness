#!/usr/bin/env bash
# 1. Electron 镜像（解决 electron-builder 拉github CDN慢/卡住）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
# 2. npm 全局镜像
npm config set registry https://registry.npmmirror.com
# 3. pnpm 镜像
pnpm config set registry https://registry.npmmirror.com
export DEBUG=electron-builder
pnpm run package:desktop:mac:arm64:unsigned 2>&1 | tee build-$(date +%Y%m%d-%H%M%S).log
