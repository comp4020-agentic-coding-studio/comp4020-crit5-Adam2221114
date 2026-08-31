# Process overview

## What I built

I built a browser-based archery rescue physics game. The player drags and releases a bow to shoot ropes and rescue hanging people with a limited number of arrows. Level 1 introduces the core mechanic, while Level 2 increases the difficulty dramatically with four people, five arrows, metal obstacles and ricochet shots. The same bow and projectile physics are kept throughout the game, so the challenge comes from the level design rather than hidden changes to the controls.

## The moments that mattered

### 1. I replaced the fake hanging animation with a real physical system

The first playable version worked mechanically, but when I looked at it in the browser the rope and the person did not feel physically connected. The character behaved more like a separate animated object, and arrows hitting the person only caused a simple visual reaction.

Instead of polishing that version, I changed the underlying model. The rope became a real constraint attached to the person, so gravity and arrow impacts make the body swing naturally. Arrows that hit the person now embed at the collision point and move with the character. When the rope is cut, the same physical body is released and falls toward the safe platform.

This changed the game from a simple shooting demonstration into something that actually felt like a physics puzzle.

[`e3ef2df`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Adam2221114/commit/e3ef2df)

### 2. Browser testing exposed problems that the automated tests did not

The automated tests were green, but actual browser play exposed problems that were not obvious from the code. One version showed the failure overlay immediately on page load because the custom CSS overrode the browser's default `[hidden]` behaviour.

A more serious problem caused every arrow to stop on its first frame. The ground had been represented using an infinite line segment, and the generic intersection calculation produced `NaN` from `Infinity × 0`. I replaced this with a dedicated ground-intersection calculation.

I verified the fixes by playing the game at both 1920×1080 and 390×844 rather than relying only on `pnpm check`.

[`e3ef2df`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Adam2221114/commit/e3ef2df)

### 3. I redesigned Level 2 because the first version was technically correct but too easy

The original Level 2 only increased the challenge slightly. After playing it, I felt that it did not justify the `DIFFICULTY SPIKE` transition and would not hold attention for long.

Instead of making the arrows faster or changing the physics, I redesigned the puzzle itself. Level 2 now has four people to rescue with only five arrows, multiple obstacles, metal surfaces that are visually separated from the wooden structures, and shots that require ricochet. Because arrows continue after cutting a rope, skilled players can also use chained shots to interact with several targets.

During browser verification, I also found that a scaffold assumed all rope anchors were at the same height, which caused one rope to appear disconnected. I corrected the scaffold geometry rather than hiding the problem visually.

[`802ac52`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Adam2221114/commit/802ac52)