# Traffic sim: phantom jams vs FSD

Top-down ring road. Left: human drivers only. Right: the same road with a share of FSD cars (slider, default 20%).
Open `index.html` (any static server). `sim.js` is the pure model (IDM car-following; humans get 0.7 s reaction delay
and pedal noise; FSD cars get ~0.1 s reaction, look 4 cars ahead, and cap speed to the smoothed traffic ahead).

Headless result (600 m loop, 34 cars, 2 min after 3 min warm-up, 2 seeds): 0% FSD ≈ 16 km/h, ~125 full stops;
20% FSD ≈ 34 km/h, 0 stops; 100% FSD ≈ 28 km/h, 0 stops (FSD keeps slightly larger gaps, so a full FSD road
is smooth but not faster than the mixed one in this model).
