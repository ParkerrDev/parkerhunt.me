+++
title = "The Problem with Modern Robotics"
date = 2026-11-04
+++

Robots need more than just cameras and encoders to operate the way we do, and right now that's pretty much all most of them have. The cameras give them a limited view of what's in front of them, the encoders tell them where their own joints are, and they have to figure out everything else from just that. They can't feel, they can't smell, they can't taste, and they don't have a good live model of the world around them like the one humans build in their heads. Humans don't work like that at all. You can tell how heavy something is and whether it's rough or smooth the second you pick it up, before you even look at it, you can smell something burning from the next room, and when a car drives past, you can hear its pitch change, and you can roughly tell how fast it's going without even thinking about it. Robots don't get any of that.

It's no wonder modern robotic AI models need so much data just to learn something: they simply don't have the rich data that we learn from. A little kid can figure out a new task in a few tries, and a robot might need hundreds or thousands of examples to learn the same thing, because it's trying to fill in everything you get directly from your skin, your nose, and your inner ear, which is basically a gyroscope and an accelerometer built into your head. I think if you gave a robot the right sensors, it wouldn't need nearly as many examples, and it could probably learn just as well as we do. And it doesn't have to stop at the senses we have. With enough engineering, robots could probably end up better than us at every one of them, and they could also take in a lot of signals that humans can't sense at all, or can only sense badly, for example:

- Thermal, UV, night, and polarized vision
- CO2 and carbon monoxide detection
- Humidity and temperature sensing
- 360 degree vision
- Eyes that can move independently and look in two directions at once

The other big gap is how well a robot knows its own body. When I first started thinking about this, I wanted a compass (a magnetometer) plus accelerometers and gyroscopes on every part of every limb... however you probably only need one magnetometer for the whole body, since once the robot knows which way its body is facing, the encoders already tell it which way every limb is facing. The accelerometers and gyroscopes are different: those are worth putting almost everywhere, so the robot can feel every bump and vibration across its whole body, instead of only knowing where its joints are. The joints already have encoders that tell the robot what angle they're at, so the accelerometers and gyroscopes should go on the parts in between the joints, with at least one on every part of the body that moves on its own, for example:

- Two on each arm
- Two on each leg
- One or two in the torso
- One on the head
- One in each hand
- One in each foot
- One in every finger, or maybe one in every segment of every finger

I've seen a few small demos of this idea online lately, and none of them have anything to do with robots. Someone on X says they turned their WiFi router into a rough radar that draws people as moving shapes on a map of their apartment, just from how the signal bounces off or bends around their bodies, with no camera and no extra sensors. The post turns into a ghost story at the end, so I'm not sure how much of it is real... however the idea itself is real, people have been using WiFi signals to detect movement in research for years. Another person wired seven regular bananas from the store into a computer, and when you touch one, your body closes the circuit, so the computer knows which banana you're touching. And there's a person who figured out how to estimate where a video was recorded from the sound of airplanes in the background. As a plane flies past, the pitch of its engines shifts because of the Doppler effect, and if you compare that shift to where the plane actually was, probably using public flight tracking data, you can work out roughly where the microphone was. All three of these show the same thing: a lot of useful information is already sitting in the air or in ordinary objects, and you just have to read it.

So I think the practical version for a robot is two things: put a lot more sensors on the robot itself, and let it use the signals that are already around it. The biggest missing one is probably touch. If you cover the hands, arms, and torso with capacitive or pressure sensors, contact becomes something the robot feels directly, instead of something the cameras have to guess from pixels. Then add everything from earlier: the accelerometers and gyroscopes, the extra types of vision, the gas sensors, etc... Give it a few microphones so it can pick up Doppler shifts and the sounds of nearby machines, and maybe let it read the WiFi signals around it too. And keep the cameras and the encoders, those aren't going anywhere. The point is to stop treating cameras and joint angles as everything a robot needs to know.

I don't think we should add every sensor imaginable, since that would mean a lot more weight, cost, and wiring for not much gain. However, I do think we should add a ton of them, enough to make the data as rich as possible. Right now most robots are trying to learn about the world from a tiny piece of the information we get, and that's probably the main reason they need so much data to learn anything. Give them more to learn from.
