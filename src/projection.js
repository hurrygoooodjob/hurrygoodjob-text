(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KineticProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const EPSILON = 1e-8;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;

  // Text effects are normalized once at the document-to-renderer boundary.
  // Dimensions are pixels in the same coordinate system as the glyph itself.
  function textStyle(input = {}, scale = 1) {
    const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
    return {
      textOpacity: clamp(finite(input.textOpacity, 1), 0, 1),
      textStrokeEnabled: input.textStrokeEnabled === true,
      textStrokeWidth: clamp(finite(input.textStrokeWidth, 2), 0, 12) * scale,
      textStrokeColor: color(input.textStrokeColor, '#111111'),
      textGlowEnabled: input.textGlowEnabled === true,
      textGlow: clamp(finite(input.textGlow, 12), 0, 40) * scale,
      textGlowColor: color(input.textGlowColor, '#d4ff75'),
      textShadowEnabled: input.textShadowEnabled === true,
      textShadowBlur: clamp(finite(input.textShadowBlur, 12), 0, 40) * scale,
      textShadowX: clamp(finite(input.textShadowX, 4), -50, 50) * scale,
      textShadowY: clamp(finite(input.textShadowY, 6), -50, 50) * scale,
      textShadowColor: color(input.textShadowColor, '#000000'),
      textShadowOpacity: clamp(finite(input.textShadowOpacity, .6), 0, 1)
    };
  }
  function stylePadding(s) {
    const stroke = s.textStrokeEnabled ? s.textStrokeWidth : 0;
    const glow = s.textGlowEnabled ? s.textGlow * 2 : 0;
    const shadow = s.textShadowEnabled ? s.textShadowBlur * 2 + Math.max(Math.abs(s.textShadowX), Math.abs(s.textShadowY)) : 0;
    return Math.ceil(Math.max(stroke, glow, shadow) + 2);
  }
  function paintStyledText(ctx, char, x, y, s) {
    // Build shadow and glow behind one opaque fill. Overall opacity is applied
    // later, after composing this glyph/layer, never to individual triangles.
    ctx.save();
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';
    if (s.textShadowEnabled && s.textShadowOpacity > 0) {
      const hex = s.textShadowColor;
      ctx.shadowColor = 'rgba(' + [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(',') + ',' + s.textShadowOpacity + ')';
      ctx.shadowBlur = s.textShadowBlur; ctx.shadowOffsetX = s.textShadowX; ctx.shadowOffsetY = s.textShadowY;
      ctx.fillText(char, x, y);
    }
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if (s.textGlowEnabled && s.textGlow > 0) {
      ctx.shadowColor = s.textGlowColor; ctx.shadowBlur = s.textGlow;
      ctx.fillText(char, x, y);
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    if (s.textStrokeEnabled && s.textStrokeWidth > 0) {
      ctx.strokeStyle = s.textStrokeColor; ctx.lineWidth = s.textStrokeWidth * 2; ctx.lineJoin = 'round';
      ctx.strokeText(char, x, y);
    }
    ctx.fillText(char, x, y); ctx.restore();
  }

  function normalizeOptions(input, canvasWidth, canvasHeight, assetWidth, assetHeight) {
    const options = input && typeof input === 'object' ? input : {};
    const width = clamp(finite(options.width, canvasWidth), 64, 12000);
    const height = clamp(finite(options.height, canvasHeight), 64, 12000);
    const safeAspect = Math.max(1, finite(assetWidth, 600)) / Math.max(1, finite(assetHeight, 900));
    let boxHeight = height * .86, boxWidth = boxHeight * safeAspect;
    if (boxWidth > width * .88) { boxWidth = width * .88; boxHeight = boxWidth / safeAspect; }
    const candidate = options.subjectBox && typeof options.subjectBox === 'object' ? options.subjectBox : {};
    boxWidth = clamp(finite(candidate.width, boxWidth), 1, width * 2);
    boxHeight = clamp(finite(candidate.height, boxHeight), 1, height * 2);
    const subjectBox = {
      x: clamp(finite(candidate.x, (width - boxWidth) / 2), -width, width * 2),
      y: clamp(finite(candidate.y, (height - boxHeight) / 2), -height, height * 2),
      width: boxWidth,
      height: boxHeight
    };
    const text = Array.from(String(options.text == null ? 'AROUND YOU • AROUND YOU •' : options.text).replace(/[\r\n\t]+/g, ' ')).slice(0, 500).join('');
    // A group can scale the document's bounded radius up or down. Keep the
    // low-level range wider so a valid group scale never silently stops moving.
    const expandedRadius=options.expandedRadius===true;
    const radiusX = clamp(finite(options.radiusX, Math.min(width * .41, boxWidth * .68)), width * (expandedRadius?.028:.08), width * (expandedRadius?1.116:.62));
    const radiusZ = clamp(finite(options.radiusZ, radiusX * .60), width * (expandedRadius?.0035:.035), width * (expandedRadius?1:.5));
    const tilt = clamp(finite(options.tilt, -18), -70, 70);
    const fontSize = clamp(finite(options.fontSize, width * .064), 8, width * .3);
    const minFocal = Math.max(width * .6, radiusZ * 1.7 + fontSize * 1.6);
    return {
      width, height, text, subjectBox, radiusX, radiusZ, tilt,
      ...textStyle(options, clamp(finite(options.textStyleScale, 1), .01, 20)),
      roll: clamp(finite(options.roll, 0), -90, 90),
      phase: ((finite(options.phase, 0) % 360) + 360) % 360,
      perspective: clamp(finite(options.perspective, width * 1.5), minFocal, width * 8),
      centerX: finite(options.ringCenterX, finite(options.centerX, subjectBox.x + subjectBox.width / 2)),
      centerY: finite(options.ringCenterY, finite(options.centerY, subjectBox.y + subjectBox.height * .44)),
      path: options.path === 'helix' ? 'helix' : 'ellipse',
      turns: clamp(finite(options.turns, 3), 1, 6),
      helixHeight: clamp(finite(options.helixHeight, height * .7), height * .1, height * 1.2),
      depthFade: clamp(finite(options.depthFade, 0), 0, 1),
      fontSize,
      fontFamily: typeof options.fontFamily === 'string' && options.fontFamily.length < 160 ? options.fontFamily : 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontWeight: clamp(finite(options.fontWeight, 800), 100, 950),
      letterSpacing: clamp(finite(options.letterSpacing, fontSize * .08), 0, fontSize),
      textColor: typeof options.textColor === 'string' ? options.textColor : typeof options.color === 'string' ? options.color : '#fff2cf',
      background: typeof options.background === 'string' ? options.background : '#343a3b',
      segments: clamp(Math.round(finite(options.segments, 8)), 2, 20),
      seamOverlap: clamp(finite(options.seamOverlap, .18), 0, .5)
    };
  }

  function ringPoint(theta, vertical, options, uv) {
    const tilt = options.tilt * Math.PI / 180;
    const z = options.radiusZ * Math.sin(theta);
    const x = options.radiusX * Math.cos(theta), y = vertical * Math.cos(tilt) - z * Math.sin(tilt);
    const roll = finite(options.roll, 0) * Math.PI / 180;
    // Rotate the completed 3D ribbon about the camera's Z axis. Depth and
    // near/far occlusion are unchanged; glyph geometry rotates with the ring.
    return {
      x: x * Math.cos(roll) - y * Math.sin(roll),
      y: x * Math.sin(roll) + y * Math.cos(roll),
      z: vertical * Math.sin(tilt) + z * Math.cos(tilt),
      u: uv ? uv.u : 0,
      v: uv ? uv.v : 0
    };
  }

  function project(vertex, options) {
    const denominator = options.perspective - vertex.z;
    if (!Number.isFinite(denominator) || denominator < Math.max(1, options.perspective * .025)) return null;
    const scale = options.perspective / denominator;
    return { x: options.centerX + vertex.x * scale, y: options.centerY + vertex.y * scale,
      z: vertex.z, u: vertex.u, v: vertex.v, scale };
  }

  // A single finite ribbon winds down the subject. The centre line lives on
  // a cylinder; a local tangent frame keeps the letters perpendicular to its
  // slope instead of shearing horizontal glyphs onto disconnected ellipses.
  function helixPoint(travel, vertical, options, uv) {
    const sweep=TAU*options.turns, theta=options.phase*Math.PI/180-travel;
    const pitch=options.tilt*Math.PI/180, sin=Math.sin(theta), cos=Math.cos(theta);
    const x=options.radiusX*cos;
    const y=(travel/sweep-.5)*options.helixHeight-options.radiusZ*sin*Math.sin(pitch);
    const z=options.radiusZ*sin*Math.cos(pitch);
    const tx=options.radiusX*sin, ty=options.helixHeight/sweep+options.radiusZ*cos*Math.sin(pitch), tz=-options.radiusZ*cos*Math.cos(pitch);
    // Normal of the elliptical cylinder, followed by normal × tangent.
    const nx=cos/options.radiusX, nz=sin/(options.radiusZ*Math.cos(pitch));
    let vx=-nz*ty, vy=nz*tx-nx*tz, vz=nx*ty;
    const length=Math.hypot(vx,vy,vz)||1;vx/=length;vy/=length;vz/=length;
    const px=x+vx*vertical, py=y+vy*vertical, roll=finite(options.roll,0)*Math.PI/180;
    return {x:px*Math.cos(roll)-py*Math.sin(roll),y:px*Math.sin(roll)+py*Math.cos(roll),z:z+vz*vertical,u:uv?uv.u:0,v:uv?uv.v:0};
  }

  function interpolate(a, b, t) {
    const out = {};
    for (const name of ['x', 'y', 'z', 'u', 'v']) out[name] = a[name] + (b[name] - a[name]) * t;
    return out;
  }

  // Split triangles at the photo's z=0 plane. A glyph may contribute to both passes.
  function clipDepth(polygon, near) {
    if (!polygon.length) return [];
    const output = [];
    const inside = point => near ? point.z >= 0 : point.z <= 0;
    let previous = polygon[polygon.length - 1], wasInside = inside(previous);
    for (const current of polygon) {
      const isInside = inside(current);
      if (wasInside !== isInside) {
        const intersection = interpolate(previous, current, previous.z / (previous.z - current.z));
        intersection.z = 0;
        output.push(intersection);
      }
      if (isInside) output.push({ ...current });
      previous = current; wasInside = isInside;
    }
    return output.filter((point, i) => !i || Math.abs(point.x-output[i-1].x)+Math.abs(point.y-output[i-1].y)+Math.abs(point.z-output[i-1].z)>EPSILON);
  }

  function triangulate(polygon) {
    const triangles = [];
    for (let i=1; i<polygon.length-1; i++) triangles.push([polygon[0],polygon[i],polygon[i+1]]);
    return triangles;
  }
  const depth = triangle => triangle.reduce((sum, p) => sum + p.z, 0) / 3;
  const sortFarToNear = triangles => triangles.slice().sort((a,b) => depth(a.vertices || a)-depth(b.vertices || b));
  const signedArea = triangle => ((triangle[1].x-triangle[0].x)*(triangle[2].y-triangle[0].y)-(triangle[2].x-triangle[0].x)*(triangle[1].y-triangle[0].y))/2;

  function arcTable(options, count = 720) {
    if(options.path==='helix') {
      count=Math.max(count,Math.ceil(options.turns*240));
      const samples=[{distance:0,theta:0}];let distance=0,previous=helixPoint(0,0,options);
      for(let i=1;i<=count;i++) {
        const theta=i/count*TAU*options.turns,point=helixPoint(theta,0,options);
        distance+=Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z);
        samples.push({distance,theta});previous=point;
      }
      return {samples,length:distance,closed:false};
    }
    const samples = [{distance:0,theta:0}];
    let distance=0, px=options.radiusX, pz=0;
    for (let i=1;i<=count;i++) {
      const theta=i/count*TAU, x=options.radiusX*Math.cos(theta), z=options.radiusZ*Math.sin(theta);
      distance+=Math.hypot(x-px,z-pz); samples.push({distance,theta}); px=x;pz=z;
    }
    return {samples,length:distance,closed:true};
  }

  function thetaAtDistance(table, distance) {
    if(table.closed!==false)distance=((distance%table.length)+table.length)%table.length;
    let lo=0,hi=table.samples.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(table.samples[mid].distance<distance)lo=mid;else hi=mid;}
    const a=table.samples[lo],b=table.samples[hi];
    return a.theta+(b.theta-a.theta)*(distance-a.distance)/Math.max(EPSILON,b.distance-a.distance);
  }

  function ribbonVertex(table, centerDistance, width, height, u, v, options) {
    if(options.path==='helix') {
      // Unlike a closed ring, the ends never wrap to the opposite end of the
      // path. The lookup extrapolates only for transparent glyph padding.
      const distance=centerDistance+(u-.5)*width;
      return helixPoint(thetaAtDistance(table,distance),(v-.5)*height,options,{u,v});
    }
    // On the visible/front half (sin(theta)>0), decreasing theta moves left-to-right.
    // Both glyph order and texture U follow this direction; the rear face naturally reverses.
    const distance=options.phase/360*table.length-centerDistance-(u-.5)*width;
    return ringPoint(thetaAtDistance(table,distance),(v-.5)*height,options,{u,v});
  }

  return { TAU, clamp, textStyle, stylePadding, paintStyledText, normalizeOptions, ringPoint, helixPoint, project, clipDepth, triangulate, depth, sortFarToNear, signedArea, arcTable, thetaAtDistance, ribbonVertex };
});
