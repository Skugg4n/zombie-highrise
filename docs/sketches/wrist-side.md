# The wrist display sketch (2026-08-25)

Ola sent a drawing in chat. The image itself lives in the conversation;
this file records what it shows, because three code comments cite it as
the spec.

Two hands, seen from the player's own point of view:

- **LEFT (how it WAS, wrong):** the hand with the palm ("HANDFLATA")
  toward the viewer, and the display strapped across the palm side of the
  wrist, like something tucked into the inside of the arm.
- **RIGHT (how it SHALL be):** the hand with the back of the hand
  ("HANDRYGG") toward the viewer, and the display lying ALONG the forearm
  on the back-of-hand side: "ovansidan av armen", the side you see when
  you look at the back of your own hand.

The geometric translation, which is what the code uses: when you hold a
controller and point it forward, the palm faces inward and the back of
the hand faces OUTWARD, sideways. The dorsal forearm continues the back
of the hand. In the weapon frame that is -X for the left arm (+X for the
right), roughly perpendicular to the weapon's +Y. "On top of the arm"
does NOT mean "toward the ceiling", which was the previous wrong premise.

On the calibration dial this is pip 10 for the left arm.
