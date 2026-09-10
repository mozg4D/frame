# Native .hash

Records follow hash.htm: uint16 type, 128-bit key, uint64 byte length, payload. No file header or manifest. Empty scene: zero bytes. All integer and floating-point payloads are little-endian.

Types: 0 uint8; 1 int8; 2 int16; 3 int32; 4 int64 (two words per hash); 5 fp32; 6 fp64; 7 UTF8. Text is only text/identifiers, never JSON. A hexadecimal key is four uint32 words, written little-endian exactly as the HTML editor does.

Keys combine by XOR: object XOR property; object XOR params XOR parameter; object XOR cage XOR column. Tags add the tags namespace and a one-based 128-bit slot value. The static property dictionary is NativeHash.keys in index.html (MD5 of UTF8 frame.hash.<label>, generated once for this implementation; all_objects retains the published key).

| Property | Hash |
|---|---|
| all | b8a4755d5309d591a5331571e7ec726f |
| kind | c98420b1c829b2afa7e45882fa498f75 |
| name | a11b9816f756a800d1fcbc6a5f4a7ff1 |
| type | 7f520c9eb59d464e8cb97745b94a0082 |
| parent | cc401e4abe821287039fbd452905dcbd |
| params | 6a55c2c34e2139dc7ffa49cb5c4e1a72 |
| height | 13e6aa58117f935866680c2807bdce08 |
| cage | ab5b13712325871cfab81cde8178480b |
| vertexIds | 2c48f18e529cb57117393a0930eaa943 |
| positions | dbc9f1fb6ce11c3a310e012c48d1c08e |
| edgeIds | a61a9c1db8ef3591a51ed9ee09941147 |
| endpoints | 8c8bc16abea2788fd4aaffe8b38d1cef |
| ha | 980dbde61541c82d169f37d60f1a8481 |
| hb | dd944e1215c5661d8354fd940abe0f57 |
| sequenceIds | fa9616ca29ee74421bd4752d6ef34147 |
| sequenceEdges | 06c331d047f8fa6574edcba8bd0010be |
| materials | d53182934907bed9e21581a9c3adc0d1 |
| animation | f91d9fec8ff1ffebb4fd669c42787546 |
| tags | 2df02de33672aac7d3c1f2e124e873ad |

Spline positions and tangents use FP64 to retain authored precision. Polygon vertex buffers use FP32, indices INT32. Cage topology is stored as indexed columns; sequence membership is stored once. Local spline identifier lists are NUL-separated UTF8; IDs cannot contain NUL. Defaults and regenerated geometry are omitted. Object order is preorder; parent references reconstruct ordered children. Material data is limited to referenced resources and a modified implicit default material.

Only this native layout is read. Former incorrect type IDs, bytewise textual hash encoding and JSON archives are not supported.
