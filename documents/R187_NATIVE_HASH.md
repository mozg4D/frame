# r187 native records, precision and bounded trajectory changes

Save, catalogue fragments and Share now use the same native .hash record codec. Share changes only URL transport encoding. The catalogue contains ordinary scenes with polygon geometry and ordinary material/tag references; names, categories and preview settings stay outside their scene payload. All 15 fragments can be opened directly. Old runtime and .hash.gz assets remain available for active r186 PWA windows, whose late library load was tested.

## Native format

Every record retains its 26-byte little-endian header: uint16 TYPE, 16-byte multidimensional XOR-address key and uint64 stored payload length. No wrapper, compression flag or decoded-length header field is added. Original object/property addresses and source ordering remain. Raw TYPE 0–8 and native-gzip TYPE 256–264 share the existing primitive semantics. Independent gzip is selected only when the complete record is smaller; tiny records remain raw.

TYPE 512–514 restore UInt32 words from XOR byte planes, modular delta varints or triangle anchor varints. TYPE 520–521 restore exact Float32 bit dictionaries, bit deltas and original scalar maps from byte planes or varints. These are reversible integer operations, with no floating subtraction, quantization, symmetry, permutation or Draco. They preserve original IEEE words, source vertex slots, indices, material selectors, source ownership and dependent Morph data. F64 authored values remain F64. The prepared source is capped at 4 MiB; larger records use ordinary gzip. Native CompressionStream has no level option and no additional encoder dependency was introduced.

Streaming limits apply without trusting a decoded-length field: 2 GiB stored/decoded file, 512 MiB ordinary decoded record, 256 MiB aggregate binary metadata and one million records. A prepared stream is capped independently at 8 MiB, its restored source at 4 MiB, and the remaining file/record quota is checked before allocating the restored output. Aggregate accounting counts restored bytes plus headers. Unknown TYPE, duplicate keys, unsafe/truncated lengths, malformed dictionaries/varints, invalid typed alignment, damaged gzip and quota excess reject before replacing the current scene. Raw caller buffers remain intact after decoded geometry mutation. Binary native metadata is retained; the format does not embed a JSON scene container.

The 15-file catalogue totals 2,100,946 bytes, versus 1,864,269 bytes for the previous p16 library (+12.70%). Plain native fragments would total3,626,244 bytes; bounded lossless preparation reduces that by 42.06%. Position payloads and integer geometry/material selectors dominate the difference. Authorized source searches found no higher-precision originals for these 15 p16 assets. Migration preserves their currently decoded F32 positions exactly and cannot recover their unknown prequantization precision.

## Precision evidence and loading

[Numeric evidence](NUMERIC_PRECISION_POLICY.md) separates storage and actual arithmetic. Source cages, handles, transforms and animation retain their F64 values. Orientation/intersection/threshold and large-parent-transform controls require the current F64/exact decisions. Display arithmetic may use its existing F32 path. No production arithmetic kernel is downcast. Explicit WebAssembly scalar/SIMD F32/F64 benchmarks include JS Number baselines and separate conversion/copy/transfer costs; Float32Array alone does not make JS arithmetic F32.

Large packed Uint32 indices are reused read-only during crease preparation when small authoring provenance cannot retain them. Small source provenance still receives its original independent copy; UInt16/interleaved/normalized input retains its previous packing path. Ten actual browser attribute/index/group/bounds/provenance controls pass. The isolated change reduced the ABBA mean first full 10M frame 17.285→16.207s (6.24%), without a consistent measured peak-memory saving.

The actual native fixture contains 10,000,000 unique indexed triangles, 5,045,100 vertices and 100 distinct relief objects over a 1,000mm square. It is synthetic, not a user production model or closed printable solid. HTTP fetch is reported separately and excluded from opening timing. No small-fixture extrapolation, instance multiplication or10M Slice claim is made.

|Release|Mean first full frame / full ready|Mean decode / geometry preparation|Observed peak Chrome private commit|
|---|---:|---:|---:|
|r186|17.023 / 17.024s|4.021 / 8.829s|1.938 / 1.929GB|
|r187 prepared records + packed-index reuse|14.252 / 14.252s|2.537 / 7.409s|1.802 / 1.799GB|

All 100 rendered meshes match r186 exactly in position/normal/other attributes, indices, groups and bounds. Peak private commit is an observed sampled Chrome-process total, not an allocation-exact bound. The opening improvements do not establish that every 10M model is fast enough; geometry preparation and renderer memory remain substantial. Ordinary plain record gzip opened this same fixture in 13.290s in a prior uncontended pair versus 17.057s for r186; the prepared comparison above is the final bounded measurement.

Complete-file native CompressionStream encoding in Node took 42.823s and codec-only decoding 16.957s. This is a separate environment and excludes browser snapshot/file IO. Native file size 61,133,524 bytes compares with 116,529,885 bytes for plain record gzip and 116,699,533 bytes for r186's envelope. The original 241,099,246-byte native source is reproduced exactly.

Chrome catalogue timing uses preloaded actual 15 files, seven alternating rotated pairs after warm-up. DecodeContainer includes gzip, restored preparation and typed native scene decoding, excludes worker transfer/geometry prep/rendering:86.1→107.4ms (+21.3ms). EncodeContainer includes serialization/gzip/preparation, excludes scene snapshot/file IO:153.8→823.6ms (+669.8ms). These costs are paid for the measured size savings; neither is presented as a speedup.

Actual staged browser writeHandle Save of the complete rendered 10M scene took 26.019s: snapshot/textures 1.246s and EncodeContainer 24.753s. The output is 61,270,297 bytes and canonically reimports all 100 meshes/10M triangles exactly. The Save path creates no Save worker. Snapshot, ordinary serialization and JS preparation run on the page; native CompressionStream is asynchronous. Baseline RAF median/p95/max was 16.7/16.7/16.8ms, versus 16.7/49.9/1400.1ms during Save, with timer maximum 1423.3ms. Frames advance through most of the operation but an approximately 1.4s stall occurs. This is not a fully responsive worker Save claim; moving serialization/preparation off the page and reducing snapshot copying remain separate follow-up work. LongTask entries with later 50–71ms durations exclude the initial boundary-crossing stall, which is measured independently by RAF/timer gaps.

## Acute widths and constrained travel

Press display now matches its .1W feed, while physical nozzle radius stays W/2. Geometrically external isolated thin feeds retain W. Thin feeds beside prior deposited material narrow W→.6W. Neighbor existence uses an exact finite linear-radius disk envelope in final actual path order/CW orientation; no-feed edges contribute no material, and same-leg expansion/contraction is excluded as longitudinal continuation. This geometric test is not a physical flow simulation.

Scheduling swaps complete independent component blocks within the same depth and rephases ordinary uniform-W closed cycles at existing vertices. First paths and certified continuous/spiral routes remain fixed. Existing longest qualifying loop-pair selection is unchanged. Global depth sequence and within-component order remain, preserving outer-before-inner and required breaks. Work is bounded at 65,536 evaluations per layer; no global travel-minimum claim.

|Perimeters|First-layer travel, r186→r187 mm|Reduction|
|---:|---:|---:|
|1|7795.994→6048.196|22.42%|
|2|11756.327→9089.534|22.68%|
|3|15459.876→12096.877|21.75%|
|7|29739.280→24392.697|17.98%|

All 363 layers at 1/2/3/7 perimeters pass serial/14-helper equality, exact source references and mapped F32 face angles, geometry up to permitted existing-vertex cycle rotation, 30,910 endpoint checks and 933 exact final-order neighbor witnesses. Browser GPU/public commands and native save/reimport agree. Scheduling/profile cost increases full-ready Slice 6.63% at count 1 and 5.77% at count 7 versus the sealed width-only candidate; travel savings are not a Slice speedup.

Position 22 placement remains unresolved. The original incoming-bank .5W restart and geometry remain exact; count 7 press/restart positions 18/22 remain. No relocation to the outgoing bank or next perimeter was inferred. W-long transitions and general complex spirals remain later work.

## Integration checks

The final release passes all 15 catalogue effective material/geometry checks, authored F64/signed-zero/cage/handle/parent/pivot/Morph controls, identical Save/fullBlob/Share scene bytes, fresh URL import with native worker completion/termination, malformed-worker current-scene retention, full-scene count 7 Slice/native reimport and actual rendered 10M equality. Normal 60-second PWA staging preserves an unsaved r186 scene and allows a previously unused old library asset afterward. Fresh r187 caches new .hash library files and supports offline Slice/native reload/library use. Legal notices, source history and prior files needed by active PWA clients are retained.
