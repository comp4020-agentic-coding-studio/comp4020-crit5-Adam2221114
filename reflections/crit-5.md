# Reflection

## What was the breakthrough that moved the work forward?

The biggest breakthrough was realising that the game needed real physical relationships, not just animations that looked correct. In the first version, the rope and person were visually separate, and hitting the person only caused a simple reaction. After testing it in the browser, I changed the model so the rope actually constrains the person, arrow impacts apply force, and arrows can embed in the body and move with it. This made the game feel much more like a real physics puzzle.

Another important change came from playing Level 2. The first design worked, but it was too easy and did not justify the “DIFFICULTY SPIKE” transition. Instead of changing the arrow physics, I redesigned the level with four people, five arrows, metal obstacles and ricochet shots. The difficulty now comes from the puzzle layout rather than hidden changes to the controls.

## What did this work change about who I want to be as a software developer?

This work made me want to rely less on whether code is technically correct and more on how the finished product actually feels to a user. Automated tests helped confirm collision rules, but they could not tell me whether the physics looked believable or whether a level was interesting. I want to become a developer who tests the real experience, notices when something feels wrong, and is willing to redesign the underlying system instead of only polishing the surface.