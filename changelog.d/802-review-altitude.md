- The browser SDR now decodes 100 ft (Gillham, Q=0) altitudes. It decoded only
  the 25 ft form, so an aircraft whose transponder encodes altitude in 100 ft
  steps, or any aircraft above 50,175 ft, showed no altitude over WebUSB while
  a dump1090 feed of the same antenna showed one. A code that maps to no
  altitude still leaves the altitude unknown (Pedro Lobato, #802).

- Local ADS-B no longer draws an aircraft at an altitude it cannot have
  reached. A corrupt frame can still pass CRC, and one reached the globe as a
  DC-9 at 108,800 ft. Each altitude report must now be reachable from the last
  accepted one at a plausible vertical rate, whether it came from the browser
  SDR or a decoder feed. A refused report keeps the previous altitude for the
  marker, the card and the 3D model alike. Three refusals in a row start over
  from the new value, and a surface report is never compared with the last
  airborne altitude. The layer stats count refusals as `rejectedAltitudes` (Pedro Lobato, #801).
