
function registerHueDimmerButtonEvents(dimmerName, dimmerObjectID, buttonActions) {
    on({id: dimmerObjectID, change: "ne"}, function (obj) {

        var buttonEventId = obj.state.val;
        var buttonActionsArray = buttonActions[buttonEventId];
        
        if (!buttonActionsArray){
            return;
        }
        if (buttonActionsArray.length == 0) {
            return
        }

        // 1004 becomes 1000
        var buttonId = Math.floor((buttonEventId / 1000)) * 1000; 

        var rootStatePath = "Sensors.HueDimmer";
        var statePathLastClickedButtonId = rootStatePath + "." + dimmerName + "." + "LastClickedButtonId";
        var statePathDoubleClickHistory = rootStatePath + "." + dimmerName + "." + buttonEventId;


        createState(statePathDoubleClickHistory, "{\"History\" : []}", () => {
            createState(statePathLastClickedButtonId, buttonId, () =>  {

                var lastClickedButtonId = getState(statePathLastClickedButtonId).val;
                setState(statePathLastClickedButtonId, buttonId);

                var doubleClickHistory = JSON.parse(getState(statePathDoubleClickHistory).val);
                if (! (lastClickedButtonId == buttonId)) {
                    // Forget history if different button was pressed earlier
                    doubleClickHistory.History = [];
                }
                else if (doubleClickHistory.History.length >= 1) {
                    var timeTheLastButtonWasPress =  doubleClickHistory.History[Math.max(doubleClickHistory.History.length - 1)];
                    var currentTime = Date.now();
                    if ((currentTime - timeTheLastButtonWasPress) > 3000)  {
                        // Not a double press if too much time in-between clicks
                        doubleClickHistory.History = [];
                    }
                }

                if (doubleClickHistory.History.length >= buttonActionsArray.length) {
                    // Reset cycle on too many presses
                    doubleClickHistory.History = [];
                }

                doubleClickHistory.History.push(Date.now());
                setState(statePathDoubleClickHistory, JSON.stringify(doubleClickHistory));

                // Execute the button Action
                var clickCounter = doubleClickHistory.History.length - 1;
                var buttonAction = buttonActionsArray[clickCounter];
                buttonAction.buttonAction();
            });
        });
    });
}

registerHueDimmerButtonEvents("MyHueDimmerSwitch01", 'deconz.0.Sensors.2.buttonevent', {
    
    /* ON Button Down */ 1000  : [
           {
                "buttonAction": () => {
                    console.log("ON Button Down Singlepress");
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 254, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log("ON Button Down Doublepress");
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 200, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log("ON Button Down Triplepress");
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 175, false, parseInt("0", 10), false);
                }
           }
    ],
    /* ON Button Up */ 1002  : [],
    /* ON Longpress */ 1003  : [],  
    /* BRIGHTER Button Down */ 2000 : [],
    /* BRIGHTER Button Up */ 2002 : [],
    /* BRIGHTER Longpress */ 2003 : [],
    /* DARKER Button Down*/ 3000 : [],
    /* DARKER Button Up */ 3002 : [],
    /* DARKER Longpress*/ 3003 : [],
    /* OFF Button Down*/ 4000 : [
            {
                "buttonAction": () => {
                    console.log("OFF Button Down Singlepress");
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 0, false, parseInt("0", 10), false);
                }
            }],
    /* OFF Button Up*/ 4002 : [],
    /* OFF Longpress*/ 4003 : []
});

