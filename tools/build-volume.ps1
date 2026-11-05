param(
  [string]$Emsdk = (Join-Path $PSScriptRoot '..\work\emsdk'),
  [string]$Ninja = (Get-Command ninja -ErrorAction SilentlyContinue).Source
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$env:EMSDK_QUIET = '1'
$env:SOURCE_DATE_EPOCH = '0'
. (Join-Path $Emsdk 'emsdk_env.ps1')
function Invoke-Build([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed ($LASTEXITCODE)" }
}
if (!$Ninja) { throw 'Install Ninja or pass -Ninja with its executable path' }
$compiler = & em++ --version
if ($LASTEXITCODE -ne 0 -or $compiler[0] -notmatch '\b4\.0\.23\b') { throw 'Volume kernel requires Emscripten 4.0.23' }
Invoke-Build node @('tools/volume/prepare-dependencies.mjs')
$deps = 'work/volume-deps'
$out = 'work/volume-build'
$geo = "$out/geogram"
$manifold = "$out/manifold"
$emscriptenCMake = Join-Path $env:EMSDK 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake'
$common = @('-G','Ninja',"-DCMAKE_MAKE_PROGRAM=$Ninja","-DCMAKE_TOOLCHAIN_FILE=$emscriptenCMake",'-DCMAKE_BUILD_TYPE=Release')
Invoke-Build cmake (@('-S',"$deps/geogram",'-B',$geo) + $common + @(
  '-DVORPALINE_PLATFORM=Frame-wasm','-DGEOGRAM_LIB_ONLY=ON','-DGEOGRAM_WITH_GRAPHICS=OFF',
  '-DGEOGRAM_WITH_TBB=OFF','-DGEOGRAM_WITH_TETGEN=OFF','-DGEOGRAM_WITH_TRIANGLE=OFF',
  '-DGEOGRAM_WITH_HLBFGS=OFF','-DGEOGRAM_WITH_LUA=OFF','-DGEOGRAM_WITH_LEGACY_NUMERICS=OFF',
  '-DCMAKE_C_FLAGS=-ffp-contract=off -DZ_HAVE_UNISTD_H=1'
))
Invoke-Build cmake (@('-S',"$deps/manifold",'-B',$manifold) + $common + @(
  '-DBUILD_SHARED_LIBS=OFF','-DMANIFOLD_PAR=OFF','-DMANIFOLD_CROSS_SECTION=OFF',
  '-DMANIFOLD_JSBIND=OFF','-DMANIFOLD_PYBIND=OFF','-DMANIFOLD_TEST=OFF',
  '-DMANIFOLD_NO_IOSTREAM=ON','-DCMAKE_CXX_FLAGS=-ffp-contract=off -fexceptions'
))
Invoke-Build cmake @('--build',$geo,'--target','geogram','--parallel','4')
Invoke-Build cmake @('--build',$manifold,'--target','manifold','--parallel','4')
Invoke-Build node @('tools/volume/build-source.mjs','extract')
Invoke-Build em++ @(
  "$out/frame-volume.cpp","$out/simplifier64.cpp","$deps/meshoptimizer/src/allocator.cpp",
  "-I$deps/meshoptimizer/src","$geo/lib/libgeogram.a","$manifold/src/libmanifold.a",
  "-I$deps/geogram/src/lib","-I$geo/src/lib","-I$deps/manifold/include","-I$manifold/include",
  '-DGEOGRAM_USE_BUILTIN_DEPS','-DMANIFOLD_NO_IOSTREAM','-DMANIFOLD_NO_FILESYSTEM',
  '-O3','-ffp-contract=off','-fexceptions','-sDISABLE_EXCEPTION_CATCHING=0',
  '-sALLOW_MEMORY_GROWTH=1','-sMAXIMUM_MEMORY=2147483648','-sSTACK_SIZE=8388608',
  '-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=node,worker,web',
  '-sEXPORTED_FUNCTIONS=["_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPF64","HEAPU32","HEAPU8","UTF8ToString"]',
  '-o',"$out/frame-volume.mjs"
)
Invoke-Build node @('tools/volume/build-source.mjs','package')
