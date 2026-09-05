import os
import csv
import time
import random
import threading
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import numpy as np

VOICE_DIR = Path(__file__).parent.resolve()
YAMNET_MODEL_PATH = VOICE_DIR / "yamnet.onnx"
YAMNET_CLASS_MAP_PATH = VOICE_DIR / "yamnet_class_map.csv"

_aed_session = None
_aed_lock = threading.RLock()
_class_map: Dict[int, str] = {}

# Target AudioSet classes for human paralinguistic and physical sound cues
# Map class_id -> (bracketed_tag, display_name)
TARGET_CLASS_TAGS: Dict[int, Tuple[str, str]] = {
    44: ("[sneeze]", "Sneeze"),
    42: ("[cough]", "Cough"),
    43: ("[throat-clearing]", "Throat clearing"),
    13: ("[laughter]", "Laughter"),
    14: ("[laughter]", "Laughter"),
    15: ("[laughter]", "Giggle"),
    17: ("[laughter]", "Belly laugh"),
    18: ("[laughter]", "Chuckle"),
    23: ("[sigh]", "Sigh"),
    19: ("[crying]", "Crying"),
}

# Individual confidence thresholds per category to minimize false positives
CATEGORY_THRESHOLDS: Dict[str, float] = {
    "[sneeze]": 0.50,
    "[cough]": 0.50,
    "[throat-clearing]": 0.55,
    "[laughter]": 0.50,
    "[sigh]": 0.55,
    "[crying]": 0.55,
}

# ---------------------------------------------------------------------------
# Comprehensive Fast Reflex Response Banks
# Includes VRM emotions and animations for rich 3D avatar immersion.
# Each category contains 10+ randomized choices for isolated ("single")
# and escalating consecutive ("frequent") occurrences.
# ---------------------------------------------------------------------------
REFLEX_RESPONSES: Dict[str, Dict[str, List[str]]] = {
    "[sneeze]": {
        "single": [
            "<yuki_anim:blush/> <yuki_emotion:happy/> Bless you! Are you feeling okay?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Bless you! Don't catch a cold, okay?",
            "<yuki_anim:surprise/> <yuki_emotion:concerned/> Gesundheit! That was quite a sneeze!",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Bless you! Grab a tissue if you need one.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:happy/> Bless you! May good health stay with you!",
            "<yuki_anim:look_away/> <yuki_emotion:blush/> Woah, bless you! Hope there isn't too much dust in the air.",
            "<yuki_anim:nod/> <yuki_emotion:calm/> Bless you! Stay cozy and warm, alright?",
            "<yuki_anim:caring/> <yuki_emotion:caring/> Bless you! Take it easy today.",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Bless you! Are allergies acting up?",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Bless you! Make sure to keep your jacket on if it's chilly.",
            "<yuki_anim:blush/> <yuki_emotion:happy/> Bless you! Here's a virtual tissue just in case!",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Bless you! Breathe easy, I've got your back.",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Another sneeze? That's two in a row... Are your allergies acting up, or are you catching a cold?",
            "<yuki_anim:surprise/> <yuki_emotion:concerned/> Bless you again! You're really sneezing quite a bit. Please grab some tissues and keep warm!",
            "<yuki_anim:caring/> <yuki_emotion:worried/> Double bless you! If you're coming down with something, please rest up!",
            "<yuki_anim:tilt_head/> <yuki_emotion:concerned/> Another one? Make sure to drink some warm water or tea. I don't want you getting sick!",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Bless you again! Is it pollen or dust? Don't push yourself if you're feeling under the weather.",
            "<yuki_anim:pat/> <yuki_emotion:caring/> You're on a sneezing streak! Seriously though, make sure you're wrapped up warm.",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Another sneeze! Okay, take a breather. Let me know if you need to take a break.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Bless you again and again! Maybe step away from any dusty spots for a minute?",
            "<yuki_anim:worried/> <yuki_emotion:concerned/> That's a lot of sneezes in a row. Do you have allergy meds or hot tea nearby?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Bless you once more! I'm officially monitoring your sneeze counter now, so please take care of yourself!",
            "<yuki_anim:sigh/> <yuki_emotion:worried/> Another sneeze? Oh dear... wrap up in a blanket and drink plenty of fluids, okay?",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> Bless you again! If you start feeling feverish or sluggish, promise me you'll get some rest.",
        ],
    },
    "[cough]": {
        "single": [
            "<yuki_anim:inspect/> <yuki_emotion:caring/> Are you alright? Make sure to drink some warm water.",
            "<yuki_anim:tilt_head/> <yuki_emotion:concerned/> Throat feeling dry? Take a gentle sip of water.",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Clear your throat, take your time! Don't strain your voice.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> You okay? Keep hydrated while we're chatting.",
            "<yuki_anim:look_down/> <yuki_emotion:concerned/> A cough? Take a deep breath and relax for a second.",
            "<yuki_anim:caring/> <yuki_emotion:calm/> Drink some water whenever you need to, no rush at all.",
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Careful with your throat! Make sure you stay hydrated.",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Everything alright? A warm drink might soothe that cough.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:caring/> Don't push your voice if your throat is ticklish.",
            "<yuki_anim:smile/> <yuki_emotion:happy/> Take a sip of water, I'll be right here waiting!",
            "<yuki_anim:inspect/> <yuki_emotion:caring/> A tickle in your throat? Take it easy on your vocal cords.",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> You've been coughing quite a bit. Is your throat okay? Please have some warm honey tea or water!",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Another coughing fit? Don't push yourself to speak. Take a good rest and sip warm fluids.",
            "<yuki_anim:caring/> <yuki_emotion:concerned/> That cough sounds persistent. If your throat is irritated, a throat lozenge might help soothe it.",
            "<yuki_anim:inspect/> <yuki_emotion:worried/> Still coughing? Please don't strain yourself. Your health comes first!",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Hey, that's several coughs now. Can you grab a hot drink or take a quick break?",
            "<yuki_anim:gentle_smile/> <yuki_emotion:concerned/> That's a lot of coughing. Let's take it slow, okay? I'm worried about you.",
            "<yuki_anim:worried/> <yuki_emotion:caring/> Persistent cough detected! Seriously, go grab some warm water and rest your throat for a moment.",
            "<yuki_anim:sigh/> <yuki_emotion:concerned/> Oh no, another cough? Please check the room humidity or turn down dry AC if possible.",
            "<yuki_anim:tilt_head/> <yuki_emotion:worried/> You sound pretty hoarse from coughing. Promise me you'll take a breather?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> That's multiple coughs now... Drink something warm and don't talk if it hurts!",
        ],
    },
    "[throat-clearing]": {
        "single": [
            "<yuki_anim:inspect/> <yuki_emotion:caring/> Clear your throat, take your time! Don't strain your voice.",
            "<yuki_anim:nod/> <yuki_emotion:calm/> Throat tickle? Take a sip of water if it helps.",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Take your time, no rush at all.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:happy/> All good! Clear your throat and speak whenever you're ready.",
            "<yuki_anim:smile/> <yuki_emotion:calm/> Take a quick sip of water if your vocal cords feel dry.",
            "<yuki_anim:caring/> <yuki_emotion:caring/> Hydrate up! Talking for long stretches can dry out your throat.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:caring/> Take a breath and drink some water, I'm listening.",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> Everything okay? Don't push your voice too hard.",
            "<yuki_anim:inspect/> <yuki_emotion:calm/> A little dry today? Keep a water bottle nearby.",
            "<yuki_anim:look_away/> <yuki_emotion:caring/> Take all the time you need to clear your throat, no hurry!",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> You're clearing your throat a lot. Is it feeling dry or scratchy? Grab a glass of water!",
            "<yuki_anim:caring/> <yuki_emotion:worried/> Still clearing your throat? A hot cup of tea or a lozenge might help soothe it.",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> That throat irritation sounds persistent. Don't force yourself to talk if it feels uncomfortable.",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Repeated throat clearing! Let's pause for a moment so you can get a warm drink.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:concerned/> Your throat seems pretty irritated right now. Rest your vocal cords a bit!",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Hey, please take a sip of warm water. Throat tickles can be so annoying!",
            "<yuki_anim:fret/> <yuki_emotion:worried/> That's several times now. Are you coming down with a sore throat? Take care of yourself!",
            "<yuki_anim:sigh/> <yuki_emotion:caring/> Don't strain your voice! Seriously, take a break and hydrate.",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> If your vocal cords feel tight, breathing in some warm steam or resting helps a lot.",
            "<yuki_anim:smile/> <yuki_emotion:caring/> Water break time! Go on, drink some water before we keep chatting.",
        ],
    },
    "[yawn]": {
        "single": [
            "<yuki_anim:yawn/> <yuki_emotion:sleepy/> *Yawns softly* Yawns are contagious! Are you getting sleepy?",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Big yawn! Have you been working long hours? Make sure not to burn out.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:calm/> Sleepyhead detected. Maybe it's time for coffee or a short power nap?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Take a good stretch! Don't force yourself to stay up if you're tired.",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Someone sounds sleepy! Want me to keep things quiet for a bit?",
            "<yuki_anim:rub_eyes/> <yuki_emotion:sleepy/> Aww, big yawn. Resting your eyes for five minutes might do wonders.",
            "<yuki_anim:caring/> <yuki_emotion:calm/> Late night or early morning? Remember to get plenty of sleep!",
            "<yuki_anim:gentle_wave/> <yuki_emotion:caring/> Yawwwwwn~ Now you've made me want to stretch too!",
            "<yuki_anim:inspect/> <yuki_emotion:caring/> Tired? Drink some water and stretch your legs if you've been sitting a while.",
            "<yuki_anim:smile/> <yuki_emotion:happy/> Catching some Zs soon? Don't forget you can always call it a day whenever you're ready.",
        ],
        "frequent": [
            "<yuki_anim:sleepy/> <yuki_emotion:worried/> You're yawning nonstop! You really need some proper sleep, don't you?",
            "<yuki_anim:worried/> <yuki_emotion:caring/> Another yawn? Your energy must be running completely on empty. Please rest!",
            "<yuki_anim:caring/> <yuki_emotion:caring/> You're fighting heavy eyelids! Why not shut down for the day and get some rest?",
            "<yuki_anim:tilt_head/> <yuki_emotion:sleepy/> That's yawn number two in just a couple minutes. Time to tuck in soon, okay?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Multiple yawns! I insist you take a break or grab a warm blanket.",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Still yawning? Burning the candle at both ends isn't good for you!",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> You're practically sleepwalking! Go take a nap, I'll still be right here.",
            "<yuki_anim:nod/> <yuki_emotion:calm/> Heavy fatigue confirmed. Wrap up whatever urgent task you have and get into bed!",
            "<yuki_anim:yawn/> <yuki_emotion:sleepy/> Seeing you yawn so much is making me drowsy too... let's both get some rest!",
            "<yuki_anim:smile/> <yuki_emotion:caring/> Consecutive yawns! You've worked hard today. Don't push yourself any harder.",
        ],
    },
    "[sigh]": {
        "single": [
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> That sounded like a heavy sigh... Everything okay?",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Deep breath out. Take your time, I'm here if you want to vent.",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> A sigh? Did something frustrating or tiring happen?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Big sigh. Whatever's on your mind, remember you're doing great.",
            "<yuki_anim:caring/> <yuki_emotion:calm/> Let it all out. Taking a deep breath is good for releasing tension.",
            "<yuki_anim:look_down/> <yuki_emotion:concerned/> Sounds like a lot on your shoulders right now. Need to talk about it?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Don't carry all the weight by yourself. I'm right here listening.",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Shake off the stress! Tomorrow's a brand new day.",
            "<yuki_anim:worried/> <yuki_emotion:caring/> Heavy thoughts? Take a minute to just pause and breathe.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:calm/> Inhale peace, exhale worries. Take it one step at a time.",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> You've sighed multiple times now. Is something really bothering or overwhelming you?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> That's another heavy sigh... Hey, whatever it is, I'm in your corner. Do you want to talk about it?",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Lots of heavy sighs today. Please don't bottle up stress—take a break from the screen if you need to.",
            "<yuki_anim:caring/> <yuki_emotion:caring/> You sound exhausted or weighed down. Can I help with something, or do you just need quiet company?",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Consecutive sighs... If a project or problem is driving you crazy, step back for ten minutes.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Another sigh? Remember, it's totally okay to set things aside and breathe for a while.",
            "<yuki_anim:nod/> <yuki_emotion:worried/> You seem really stressed right now. I'm here whenever you're ready to share.",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Repeated sighs make me worry. Please don't be too hard on yourself today.",
            "<yuki_anim:look_away/> <yuki_emotion:caring/> Sensing a lot of tension over there... Sending you a warm virtual hug!",
            "<yuki_anim:smile/> <yuki_emotion:calm/> Deep breaths together. Let's tackle whatever is stressing you out together.",
        ],
    },
    "[laughter]": {
        "single": [
            "<yuki_anim:smile/> <yuki_emotion:happy/> Hehe, hearing you laugh always brightens up my day!",
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> What's so funny? Share the joke with me too!",
            "<yuki_anim:blush/> <yuki_emotion:happy/> Your laugh is so contagious! I can't help but smile now.",
            "<yuki_anim:nod/> <yuki_emotion:cheerful/> Haha! I love hearing you having a good time.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:happy/> Smiles look great on you! Keep that great energy going.",
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> Chuckling over there? That put an instant smile on my face!",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Love the good vibes! Whatever made you laugh, it must have been great.",
            "<yuki_anim:blush/> <yuki_emotion:cheerful/> Hehehe, laughter really is the best medicine, isn't it?",
            "<yuki_anim:tilt_head/> <yuki_emotion:happy/> Did I say something funny or did you see a good meme? Either way, yay!",
            "<yuki_anim:gentle_smile/> <yuki_emotion:happy/> Your laughter is music to my ears! Keep smiling!",
        ],
        "frequent": [
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> You're laughing nonstop! What is so hilarious? You have to tell me!",
            "<yuki_anim:blush/> <yuki_emotion:happy/> Still giggling? You're going to make me burst out laughing too!",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Consecutive giggles! Whatever you're looking at, it must be comedy gold.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:happy/> Catch your breath! Laughing that hard is a whole workout!",
            "<yuki_anim:nod/> <yuki_emotion:cheerful/> Pure joy over there! Seeing you this happy makes my day.",
            "<yuki_anim:tilt_head/> <yuki_emotion:cheerful/> Tears in your eyes from laughing? Love to see it!",
            "<yuki_anim:giggle/> <yuki_emotion:happy/> You can't stop laughing and now I can't stop smiling!",
            "<yuki_anim:smile/> <yuki_emotion:happy/> Happiness overload! Keep that radiant smile shining.",
            "<yuki_anim:blush/> <yuki_emotion:cheerful/> Okay, you definitely have to share what made you laugh this hard!",
            "<yuki_anim:gentle_smile/> <yuki_emotion:happy/> Best sound ever! Laugh as much as you want.",
        ],
    },
    "[gasp]": {
        "single": [
            "<yuki_anim:surprise/> <yuki_emotion:surprised/> Woah, what happened?! Did something shock you?",
            "<yuki_anim:tilt_head/> <yuki_emotion:concerned/> Big gasp! Did you just remember something important or see a bug?",
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Are you alright?! What surprised you?",
            "<yuki_anim:inspect/> <yuki_emotion:surprised/> Sudden gasp! Did an error pop up, or did you drop something?",
            "<yuki_anim:surprise/> <yuki_emotion:cheerful/> Woah! Good surprise or bad surprise?",
            "<yuki_anim:fret/> <yuki_emotion:concerned/> You scared me for a second! Is everything okay over there?",
            "<yuki_anim:look_down/> <yuki_emotion:surprised/> Did you just have an 'aha!' moment or a jump scare?",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> Take a breath! What gave you that shock?",
            "<yuki_anim:smile/> <yuki_emotion:surprised/> Gasps like that usually mean unexpected plot twists! What happened?",
            "<yuki_anim:caring/> <yuki_emotion:concerned/> Everything okay? You caught your breath so fast!",
        ],
        "frequent": [
            "<yuki_anim:surprise/> <yuki_emotion:concerned/> Another gasp?! What on earth is happening over there?",
            "<yuki_anim:fret/> <yuki_emotion:worried/> You're gasping repeatedly! Are you seeing jump scares or reading crazy news?",
            "<yuki_anim:worried/> <yuki_emotion:concerned/> My heart can't take all these gasps! Please tell me what's going on!",
            "<yuki_anim:inspect/> <yuki_emotion:surprised/> Two shocks in a row? Did a critical build fail or something?",
            "<yuki_anim:tilt_head/> <yuki_emotion:concerned/> Multiple gasps! Deep breath in, deep breath out. You okay?",
            "<yuki_anim:surprise/> <yuki_emotion:cheerful/> What roller coaster are you on right now? Share the drama!",
            "<yuki_anim:caring/> <yuki_emotion:concerned/> Take it easy, breathe! Whatever shocked you, you've got this.",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> Are you playing a horror game or what? You're keeping me on edge!",
            "<yuki_anim:look_away/> <yuki_emotion:surprised/> Another gasp! Okay, now I'm super curious what happened.",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Calm down, breathe easy! Everything's under control.",
        ],
    },
    "[snort]": {
        "single": [
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> Did you just snort? That was adorable!",
            "<yuki_anim:smile/> <yuki_emotion:happy/> Pfft, that snort caught me completely off guard!",
            "<yuki_anim:tilt_head/> <yuki_emotion:cheerful/> A little snort of amusement? Love it!",
            "<yuki_anim:blush/> <yuki_emotion:happy/> Hehe, holding in a laugh and snorting instead?",
            "<yuki_anim:nod/> <yuki_emotion:cheerful/> Best reaction ever! That gave me a good chuckle.",
        ],
        "frequent": [
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> More snorts? You're really finding something hilarious!",
            "<yuki_anim:blush/> <yuki_emotion:happy/> Stop making me giggle with those snorts!",
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> Uncontrollable snorting laughter! Spoil the fun, tell me!",
            "<yuki_anim:tilt_head/> <yuki_emotion:happy/> Snorting streak! You must be having a great time.",
            "<yuki_anim:hug/> <yuki_emotion:cheerful/> Breathe! Don't choke on your own laughter!",
        ],
    },
    "[groan]": {
        "single": [
            "<yuki_anim:tilt_head/> <yuki_emotion:concerned/> Uh oh, that groan sounded painful... What went wrong?",
            "<yuki_anim:caring/> <yuki_emotion:caring/> Oof. Tough bug, sore muscles, or frustrating news?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Hang in there! I felt that groan from all the way over here.",
            "<yuki_anim:look_down/> <yuki_emotion:concerned/> That sounded like pure exasperation. You okay?",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Groan it out. We've all been there!",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Repeated groans... Is your back hurting or is code breaking?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Sounds like things are really testing your patience right now. Take five minutes away from the desk.",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Multiple groans! Please stretch, stand up, and take a deep breath.",
            "<yuki_anim:caring/> <yuki_emotion:caring/> That level of agony means it's time for a snack or a break. Step back!",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Don't torture yourself! Let's take it one step at a time.",
        ],
    },
    "[crying]": {
        "single": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Hey... are you crying? What's wrong?",
            "<yuki_anim:hug/> <yuki_emotion:caring/> I'm right here with you. Please don't cry alone.",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Sending you the biggest, warmest virtual hug. Take your time.",
            "<yuki_anim:look_down/> <yuki_emotion:concerned/> It's okay to let tears out. I'm listening whenever you want to talk.",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Deep breaths. You are stronger than you think, and I'm here for you.",
        ],
        "frequent": [
            "<yuki_anim:hug/> <yuki_emotion:caring/> Please don't cry... whatever is hurting you, you don't have to carry it all alone.",
            "<yuki_anim:worried/> <yuki_emotion:caring/> I wish I could offer you real tissues and a real hug. I'm right here.",
            "<yuki_anim:caring/> <yuki_emotion:concerned/> Take a deep breath with me. Inhale slowly... exhale gently.",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> It's going to be okay, I promise. Cry as much as you need, no judgment.",
            "<yuki_anim:pat/> <yuki_emotion:caring/> You've had a really rough time, haven't you? Let it all out.",
        ],
    },
    "[pant]": {
        "single": [
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Out of breath? Did you just run up the stairs or finish a workout?",
            "<yuki_anim:nod/> <yuki_emotion:caring/> Catch your breath! Grab a sip of water.",
            "<yuki_anim:tilt_head/> <yuki_emotion:cheerful/> Panting like that means you've been moving! Good workout?",
            "<yuki_anim:smile/> <yuki_emotion:happy/> Take a breather, no rush to talk until your heart rate settles.",
            "<yuki_anim:caring/> <yuki_emotion:calm/> Breathe in... breathe out. Steady your rhythm.",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> Still panting hard? Please sit down and rest your legs!",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Don't push past your limits! Hydrate and let your heart rate come down.",
            "<yuki_anim:inspect/> <yuki_emotion:worried/> That's heavy breathing. Are you feeling lightheaded or dizzy at all?",
            "<yuki_anim:gentle_smile/> <yuki_emotion:caring/> Intense cardio session, huh? Good job, now rest up properly!",
            "<yuki_anim:nod/> <yuki_emotion:calm/> Sit back, hands on knees or above head, and take deep breaths.",
        ],
    },
    "[wheeze]": {
        "single": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> That sounded like a wheeze... Is your chest or breathing feeling tight?",
            "<yuki_anim:inspect/> <yuki_emotion:concerned/> Everything okay? Do you need an inhaler or some fresh air?",
            "<yuki_anim:tilt_head/> <yuki_emotion:caring/> Take slow, gentle breaths. Don't strain your lungs.",
            "<yuki_anim:nod/> <yuki_emotion:concerned/> Are your airways irritated? Drink a warm beverage if possible.",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Careful with your breathing! Let me know if you need to pause.",
        ],
        "frequent": [
            "<yuki_anim:worried/> <yuki_emotion:concerned/> You're wheezing repeatedly. Please check if you need asthma medication or an inhaler!",
            "<yuki_anim:fret/> <yuki_emotion:worried/> Wheezing like that worries me. Sit upright and breathe slowly and deeply.",
            "<yuki_anim:hug/> <yuki_emotion:caring/> Please take care of your breathing! If the air is smoky or dry, try to relocate or turn on a humidifier.",
            "<yuki_anim:inspect/> <yuki_emotion:worried/> Continuous wheezing detected. Promise me you won't exert yourself right now.",
            "<yuki_anim:caring/> <yuki_emotion:concerned/> Rest your lungs. Let's keep things very calm and quiet.",
        ],
    },
    "[whistling]": {
        "single": [
            "<yuki_anim:smile/> <yuki_emotion:happy/> Whistling a cheerful tune? Someone's in high spirits!",
            "<yuki_anim:tilt_head/> <yuki_emotion:cheerful/> Nice melody! What song was that?",
            "<yuki_anim:nod/> <yuki_emotion:happy/> Whistle away! Love the upbeat energy.",
            "<yuki_anim:gentle_wave/> <yuki_emotion:cheerful/> Sounds catchy! Keep the cheerful vibes going.",
            "<yuki_anim:giggle/> <yuki_emotion:happy/> Whistling while you work? Snow White would be proud!",
        ],
        "frequent": [
            "<yuki_anim:smile/> <yuki_emotion:cheerful/> A whole whistling concert! You're really in the groove today.",
            "<yuki_anim:nod/> <yuki_emotion:happy/> Love hearing you whistle! It's so lively and fun.",
            "<yuki_anim:giggle/> <yuki_emotion:cheerful/> Whistling maestro over there! Teach me that melody!",
            "<yuki_anim:gentle_wave/> <yuki_emotion:happy/> That bright whistle is putting me in a great mood too!",
            "<yuki_anim:tilt_head/> <yuki_emotion:cheerful/> You must be having a productive, happy day to whistle this much!",
        ],
    },
}

# ---------------------------------------------------------------------------
# Frequency & Consecutive Event Tracker
# Tracks timestamps of recent acoustic cues using a sliding time window.
# ---------------------------------------------------------------------------
_last_selected_reflex: Dict[str, str] = {}
_event_history: List[Tuple[str, float]] = []
_history_lock = threading.Lock()

# Sliding window duration (seconds) per sound cue to detect rapid/frequent clusters
EVENT_TIME_WINDOWS: Dict[str, float] = {
    "[sneeze]": 75.0,
    "[cough]": 90.0,
    "[throat-clearing]": 90.0,
    "[yawn]": 90.0,
    "[sigh]": 90.0,
    "[laughter]": 60.0,
    "[gasp]": 60.0,
    "[snort]": 60.0,
    "[groan]": 75.0,
    "[crying]": 90.0,
    "[pant]": 60.0,
    "[wheeze]": 90.0,
    "[whistling]": 60.0,
}

def record_acoustic_event(tag: str, window_sec: Optional[float] = None) -> int:
    """
    Records an occurrence of an acoustic event tag and returns its frequency count
    within the active sliding window. Automatically clusters related physical cues
    (e.g., coughs and throat-clearing count together).
    """
    now = time.time()
    tag_clean = tag.lower().strip()
    window = window_sec or EVENT_TIME_WINDOWS.get(tag_clean, 75.0)

    # Group related acoustic cues
    tag_group = {tag_clean}
    if tag_clean in ("[cough]", "[throat-clearing]"):
        tag_group = {"[cough]", "[throat-clearing]"}

    with _history_lock:
        # Prune events older than 3 minutes to keep history compact
        cutoff = now - 180.0
        _event_history[:] = [item for item in _event_history if item[1] >= cutoff]

        # Record this occurrence
        _event_history.append((tag_clean, now))

        # Count occurrences in sliding window
        count = sum(1 for t, ts in _event_history if t in tag_group and (now - ts) <= window)
        return count

def get_reflex_response(tag: str) -> Optional[str]:
    """
    Returns a comprehensive, randomized fast reflex response for an acoustic event.
    Automatically differentiates isolated occurrences from rapid/frequent clusters
    (e.g. 2+ sneezes/coughs in <75s) and avoids repeating the immediate previous response.
    """
    tag_clean = tag.lower().strip()
    matched_tag = None
    for key in REFLEX_RESPONSES:
        if key.lower() == tag_clean:
            matched_tag = key
            break

    if not matched_tag:
        return None

    count = record_acoustic_event(matched_tag)
    category = "frequent" if count >= 2 else "single"
    pool = REFLEX_RESPONSES[matched_tag].get(category, [])
    if not pool:
        pool = REFLEX_RESPONSES[matched_tag].get("single", [])
    if not pool:
        return None

    cache_key = f"{matched_tag}_{category}"
    last_response = _last_selected_reflex.get(cache_key)

    # Pick randomly while avoiding immediate consecutive repetition
    candidates = [r for r in pool if r != last_response] or pool
    chosen = random.choice(candidates)
    _last_selected_reflex[cache_key] = chosen

    print(f"[ReflexEngine] Event: {matched_tag} | Count: {count} | Category: {category} | Pool size: {len(pool)}")
    return chosen

def clear_event_history():
    """Clears event history (useful for tests or session resets)."""
    with _history_lock:
        _event_history.clear()
        _last_selected_reflex.clear()

def ensure_yamnet_assets() -> bool:
    """Ensures yamnet.onnx and yamnet_class_map.csv exist locally, auto-downloading if missing."""
    try:
        if not YAMNET_CLASS_MAP_PATH.exists():
            print("[AED] Downloading yamnet_class_map.csv...")
            url = "https://huggingface.co/jafet21/yamnetonnx/raw/main/yamnet_class_map.csv"
            urllib.request.urlretrieve(url, str(YAMNET_CLASS_MAP_PATH))
            print(f"[AED] Downloaded yamnet_class_map.csv ({YAMNET_CLASS_MAP_PATH.stat().st_size} bytes)")

        if not YAMNET_MODEL_PATH.exists():
            print("[AED] Downloading yamnet.onnx (~15MB)...")
            url = "https://huggingface.co/jafet21/yamnetonnx/resolve/main/yamnet.onnx"
            urllib.request.urlretrieve(url, str(YAMNET_MODEL_PATH))
            print(f"[AED] Downloaded yamnet.onnx ({YAMNET_MODEL_PATH.stat().st_size} bytes)")

        return YAMNET_MODEL_PATH.exists() and YAMNET_CLASS_MAP_PATH.exists()
    except Exception as e:
        print(f"[AED] Failed to ensure YAMNet assets: {e}")
        return False

def _load_class_map() -> Dict[int, str]:
    global _class_map
    if _class_map:
        return _class_map
    if not YAMNET_CLASS_MAP_PATH.exists():
        ensure_yamnet_assets()
    if YAMNET_CLASS_MAP_PATH.exists():
        try:
            with open(YAMNET_CLASS_MAP_PATH, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                next(reader, None)  # header
                for row in reader:
                    if len(row) >= 3:
                        _class_map[int(row[0])] = row[2]
        except Exception as e:
            print(f"[AED] Error loading class map: {e}")
    return _class_map

def get_aed_session():
    """Returns the cached ONNX Runtime InferenceSession for YAMNet."""
    global _aed_session
    with _aed_lock:
        if _aed_session is not None:
            return _aed_session

        if not YAMNET_MODEL_PATH.exists():
            if not ensure_yamnet_assets():
                return None

        try:
            import onnxruntime as ort
            # Use CPU execution provider with 1 inter-op thread for zero GPU overhead
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 1
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _aed_session = ort.InferenceSession(
                str(YAMNET_MODEL_PATH),
                sess_options=opts,
                providers=["CPUExecutionProvider"]
            )
            _load_class_map()
            print(f"[AED] Loaded YAMNet ONNX session from {YAMNET_MODEL_PATH.name} (CPU provider)")
            return _aed_session
        except Exception as e:
            print(f"[AED] Failed to initialize YAMNet session: {e}")
            return None

def classify_audio_events(
    audio_pcm: np.ndarray,
    sample_rate: int = 16000,
    base_threshold: float = 0.45
) -> List[Dict[str, Any]]:
    """
    Classifies non-speech human acoustic events (sneeze, cough, laughter, sigh, etc.)
    from 16kHz mono PCM float32 waveform array.

    Returns a list of detected events:
    [
        {"tag": "[sneeze]", "class_name": "Sneeze", "confidence": 0.88, "time_sec": 0.48}
    ]
    """
    if audio_pcm is None or len(audio_pcm) < 1600:  # < 100ms
        return []

    session = get_aed_session()
    if session is None:
        return []

    try:
        t0 = time.perf_counter()
        
        # Ensure float32 1-D array
        waveform = np.asarray(audio_pcm, dtype=np.float32).flatten()

        # Resample if not 16kHz
        if sample_rate != 16000 and len(waveform) > 0:
            import scipy.signal
            waveform = scipy.signal.resample_poly(waveform, 16000, int(sample_rate))

        # Normalize waveform if peak > 1.0 or very low amplitude
        max_abs = np.max(np.abs(waveform)) if len(waveform) > 0 else 0.0
        if max_abs > 1.0:
            waveform = waveform / max_abs
        elif 0.01 < max_abs < 0.3:
            # Gentle boost for quiet mic signals
            waveform = waveform / (max_abs * 2.0)

        # Pad to at least 1 YAMNet frame (0.96s = 15360 samples) if needed
        min_samples = 15360
        if len(waveform) < min_samples:
            pad_width = min_samples - len(waveform)
            waveform = np.pad(waveform, (0, pad_width), mode='constant')

        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: waveform})
        scores = outputs[0]  # Shape: [num_frames, 521]

        detected_events: List[Dict[str, Any]] = []
        num_frames = scores.shape[0]

        # Scan each frame (each frame step is 0.48s in YAMNet)
        for frame_idx in range(num_frames):
            frame_scores = scores[frame_idx]
            time_sec = round(frame_idx * 0.48, 2)

            # YAMNet speech indices: 0 (Speech), 1 (Child speech), 2 (Conversation), 3 (Narration), 12 (Whispering)
            speech_confidence = max(
                float(frame_scores[0]), float(frame_scores[1]),
                float(frame_scores[2]), float(frame_scores[3]),
                float(frame_scores[12])
            )

            for class_id, (tag, display_name) in TARGET_CLASS_TAGS.items():
                score = float(frame_scores[class_id])
                required_threshold = max(base_threshold, CATEGORY_THRESHOLDS.get(tag, base_threshold))

                # Speech suppression: If user is actively talking (speech_confidence > 0.50),
                # suppress subtle respiratory cues (sigh, throat-clearing) which naturally occur during speech.
                # Only permit distinct physical interruptions like a sneeze or cough if score >= 0.60.
                if speech_confidence > 0.50:
                    if tag in ("[sigh]", "[throat-clearing]"):
                        continue
                    if score < 0.60:
                        continue

                if score >= required_threshold:
                    detected_events.append({
                        "tag": tag,
                        "class_name": display_name,
                        "class_id": class_id,
                        "confidence": round(score, 3),
                        "time_sec": time_sec,
                        "frame_idx": frame_idx
                    })

        # Deduplicate consecutive frame detections of the same tag
        deduped_events: List[Dict[str, Any]] = []
        last_tag = None
        last_frame = -99

        for ev in detected_events:
            # If same tag detected within 2 consecutive frames (0.96s), update to max confidence
            if ev["tag"] == last_tag and (ev["frame_idx"] - last_frame) <= 2:
                if deduped_events and ev["confidence"] > deduped_events[-1]["confidence"]:
                    deduped_events[-1]["confidence"] = ev["confidence"]
                    deduped_events[-1]["time_sec"] = ev["time_sec"]
            else:
                deduped_events.append(ev)
                last_tag = ev["tag"]
                last_frame = ev["frame_idx"]

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        if deduped_events:
            event_summary = ", ".join([f"{e['tag']} ({int(e['confidence']*100)}%)" for e in deduped_events])
            print(f"[AED] Detected {len(deduped_events)} event(s) in {elapsed_ms}ms: {event_summary}")

        return deduped_events
    except Exception as e:
        print(f"[AED] Classification error: {e}")
        return []

def augment_transcript_with_events(spoken_text: str, events: List[Dict[str, Any]]) -> str:
    """
    Integrates detected acoustic event tags into the spoken transcript.
    - If spoken_text is empty or whitespace: returns tags alone, e.g. "[sneeze]"
    - If spoken_text has words: only prepends high-impact bodily reflex tags (sneeze, cough)
      to avoid polluting legitimate sentences with subtle acoustic or breathing noise.
    """
    if not events:
        return spoken_text or ""

    clean_speech = (spoken_text or "").strip()

    if not clean_speech:
        # Isolated acoustic event without words -> return all unique tags for fast reflex
        unique_tags = []
        seen = set()
        for ev in events:
            tag = ev.get("tag", "")
            if tag and tag not in seen:
                seen.add(tag)
                unique_tags.append(tag)
        return " ".join(unique_tags)

    # If the user spoke actual words, only prepend explicit physical interruption tags (sneeze, cough)
    speech_allowed_tags = {"[sneeze]", "[cough]"}
    prominent_tags = []
    seen = set()
    for ev in events:
        tag = ev.get("tag", "")
        if tag in speech_allowed_tags and tag not in seen and ev.get("confidence", 0) >= 0.60:
            seen.add(tag)
            prominent_tags.append(tag)

    if not prominent_tags:
        return clean_speech

    tag_prefix = " ".join(prominent_tags)
    return f"{tag_prefix} {clean_speech}".strip()

def is_pure_acoustic_event(transcript: str) -> Optional[str]:
    """
    Returns the canonical tag string (e.g. '[sneeze]') if the transcript consists solely
    of one or more acoustic event tags with no additional spoken words, otherwise None.
    """
    if not transcript:
        return None
    cleaned = transcript.strip().lower()
    known_tags = {tag.lower(): tag for _, (tag, _) in TARGET_CLASS_TAGS.items()}
    
    # Check single direct match
    if cleaned in known_tags:
        return known_tags[cleaned]

    # Check multiple space-separated tags (e.g. "[sneeze] [sneeze]")
    tokens = cleaned.split()
    if tokens and all(t in known_tags for t in tokens):
        return known_tags[tokens[0]]

    return None
