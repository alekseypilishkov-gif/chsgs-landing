#define M_PI 3.1415926535897932384626433832795

uniform sampler2D tDiffuse;
uniform sampler2D tGradient;

uniform float uTime;

uniform float uTileProgressVertical;
uniform float uTileProgressHorizontal;
uniform float uTileAmplitude;
uniform vec2 uTileFrequency;
uniform vec2 uTileOffset;

uniform float uWaveProgress;
uniform float uWaveAmplitude;
uniform vec2 uWaveStrength;

uniform float uGradientProgress;
uniform float uGradientOffset;
uniform float uGradientAmplitude;

uniform float uBlueProgress;
uniform float uBlueAmplitude;

uniform float uWhiteTileChances;
uniform float uWhiteTileFrequency;
uniform float uWhiteTileStrength;

uniform float uSaturation;

varying vec2 vUv;

float random (in vec2 _st)
{
    return fract(sin(dot(_st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

vec2 getTileCoord(vec2 pos, vec2 frequency)
{
    vec2 coord = vec2(floor(pos.x * frequency.x), floor(pos.y * frequency.y));
    coord /= frequency;

    return coord;
}

float toSin(float _value)
{
    return (sin((_value - 0.5) * M_PI) + 1.0) / 2.0;
}

void main()
{
    // Tiles
    vec2 tileCoord1 = getTileCoord(vUv, vec2(uTileFrequency * 1.8942));
    vec2 tileCoord2 = getTileCoord(vUv, vec2(uTileFrequency * 1.0));
    vec2 tileCoord3 = getTileCoord(vUv, vec2(uTileFrequency * 2.1245));
    vec2 tileCoord = tileCoord2 + step(random(tileCoord1), 0.5) * (tileCoord3 - tileCoord2);
    float tileRandom = random(tileCoord);
    float tileAngle = tileRandom * M_PI * 2.0;
    vec2 tileOffset = vec2(sin(tileAngle), cos(tileAngle)) * uTileOffset;
    // float tileProgress = 1.0 - (distance(tileCoord.x, uTileProgressHorizontal) / (uTileAmplitude * 0.5));
    float tileProgress = 1.0 - (distance(tileCoord.y, uTileProgressVertical) / (uTileAmplitude * 0.5));
    tileProgress = clamp(tileProgress, 0.0, 1.0);

    // Wave
    float waveProgress = 1.0 - (distance(vUv.x, uWaveProgress) / (uWaveAmplitude * 0.5));
    waveProgress = clamp(waveProgress, 0.0, 1.0);
    vec2 waveOffset = toSin(waveProgress) * uWaveStrength;

    // Gradient
    float gradientProgress = (tileCoord.x - uGradientProgress) / uGradientAmplitude;
    gradientProgress += (tileRandom - 0.5) * uGradientOffset;
    vec4 gradientColor = texture2D(tGradient, vec2(clamp(gradientProgress, 0.0, 1.0), 0.0));

    // Blue
    float blueProgress = (tileCoord.x - uBlueProgress) / uBlueAmplitude;
    blueProgress += tileOffset.x;
    blueProgress = clamp(blueProgress, 0.0, 1.0);

    // White tiles
    float whiteTileProgress = sin(uTime * uWhiteTileFrequency + tileRandom * M_PI * 2.0) * 0.5 + 0.5;
    whiteTileProgress = clamp(whiteTileProgress - (1.0 - uWhiteTileChances), 0.0, 1.0) * (1.0 / uWhiteTileChances) * uWhiteTileStrength;

    // Color
    vec2 uv = vUv;

    // Apply tiles
    uv += tileOffset * tileProgress; // Tiles

    // Apply waves
    // uv += waveOffset; // Wave

    // Repeat UV
    uv = mod(uv, vec2(1.0));

    vec4 color = texture2D(tDiffuse, uv);

    // Apply gradient
    color.rgb += gradientColor.rgb * gradientColor.a;

    // Apply white tile
    color.rgb += vec3(whiteTileProgress);

    // Apply blue
    vec3 blueColor = vec3((color.r + color.g + color.b) / 3.0) * vec3(0.3, 0.5, 1.0);
    color.rgb = mix(color.rgb, blueColor, vec3(blueProgress));

    // Apply saturation
    color.rgb *= uSaturation;

    // color *= gradientColor;

    // gl_FragColor = vec4(tileCoord, 1.0, 1.0);
    // gl_FragColor = vec4(vec3(tileRandom), 1.0);
    // gl_FragColor = vec4(vec3(tileProgress), 1.0);
    // gl_FragColor = vec4(vec3(gradientProgress), 1.0);
    // gl_FragColor = vec4(vec2(gradientProgress, 0.0) + tileOffset, 0.0, 1.0);
    // gl_FragColor = gradientColor;
    // gl_FragColor = vec4(vec3(blueProgress), 1.0);
    gl_FragColor = color;
}
