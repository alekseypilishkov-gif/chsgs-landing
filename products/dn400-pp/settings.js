export const extractionPaths={
  body:[[0,[0,0,0]],[.18,[0,0,0]],[.52,[1.55,0,0]],[.82,[1.55,-1.4,.3]],[1,[0,-1.4,.3]]],
  ball:[[0,[0,0,0]],[1,[0,0,0]]],
  'left-flange':[[0,[0,0,0]],[.28,[-3.3,0,0]],[1,[-3.3,0,0]]],
  'right-flange':[[0,[0,0,0]],[.28,[3.3,0,0]],[1,[3.3,0,0]]],
  'left-pipe':[[0,[0,0,0]],[.1,[0,0,0]],[.36,[-2.5,0,0]],[1,[-2.5,0,0]]],
  'right-pipe':[[0,[0,0,0]],[.1,[0,0,0]],[.36,[2.5,0,0]],[1,[2.5,0,0]]],
  gearbox:[[0,[0,0,0]],[.30,[0,1.45,0]],[.8,[.45,1.45,-.1]],[1,[.45,1.45,-.1]]],
  handwheel:[[0,[0,0,0]],[.3,[0,1.45,0]],[.8,[-.65,1.45,.25]],[1,[-.65,1.45,.25]]],
  neck:[[0,[0,0,0]],[.42,[0,.65,0]],[.75,[-1,.65,.12]],[1,[-1,.65,.12]]],
  adapter:[[0,[0,0,0]],[.35,[0,1,0]],[.78,[1,.65,-.1]],[1,[1,.65,-.1]]],
  stem:[[0,[0,0,0]],[.30,[0,0,0]],[.7,[0,.55,.15]],[1,[0,.55,.15]]],
};

// Blue coating follows the user-supplied liquid-service valve reference; no RAL grade asserted.
export const reflectionEnvironments={polishedSteel:{wallColor:0xbfc1c4,boxColor:0x292d32,blur:.02}};
// Match the accepted polished stainless ball rather than a dark painted finish.
export const pipelineFinish={color:0xe2e4e7,metalness:1,roughness:.16,envMapIntensity:1.15};
// 16 hole centres, R275 and R16.5 are measured from the supplied STEP,
// scaled by 500. Fastener/gasket dimensions below are display parameters.
export const flangeConnection={count:16,pitchRadius:.55,phase:Math.PI/16,holeRadius:.033,gasketInner:.406,gasketOuter:.505,gasketThickness:.008,standOff:.28,studRadius:.030,nutRadius:.053,nutWidth:.048,threadPitch:.006};
export const materials={bluePaint:{color:0x16345f,metalness:.12,roughness:.38},paint:{color:0x35393e,metalness:.64,roughness:.31},gear:{color:0x202326,metalness:.42,roughness:.34},steel:{color:0xbfc4c9,metalness:.95,roughness:.24},stainless:{color:0xe2e4e7,metalness:1,roughness:.16,envMapIntensity:1.15,reflectionEnvironment:'polishedSteel'},spring:{color:0x8e969f,metalness:.92,roughness:.27},seat:{color:0x202226,metalness:0,roughness:.56},seal:{color:0x61ac38,metalness:0,roughness:.62},blueSeal:{color:0x3556c9,metalness:0,roughness:.62},ptfe:{color:0xe5e4da,metalness:0,roughness:.57},brass:{color:0xb9a15c,metalness:.66,roughness:.25}};
