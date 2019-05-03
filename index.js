var DimmerStatePath = "Sensors.HueDimmer";

function currentDate() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getButtonFromButtonId(buttonId) {
    return Math.floor((buttonId / 1000)) * 1000;
}

function registerHueDimmerButtonEvents(dimmerName, dimmerObjectID, funcObjc) {
    on({id: dimmerObjectID, change: "ne"}, function (obj) {
        var hueDimmerButtonId = obj.state.val;
        var oldValue = obj.oldState.val;

        var statePathLastButton = DimmerStatePath + "." + dimmerName +"."+ "LastButton";
        var statePathClickHistory = DimmerStatePath + "." + dimmerName +"."+ hueDimmerButtonId;

        var registerEvents = function ()  {

            var buttonActionsMap = funcObjc[hueDimmerButtonId.toString()];
            if (!buttonActionsMap) {
                return;
            }
            if (buttonActionsMap.length == 0) {
                return
            }

            var maxArrayLength = buttonActionsMap.length;


            // Get Last Button State
            var currentButton = getButtonFromButtonId(hueDimmerButtonId);
            var lastButton = getState(statePathLastButton).val;
            
            // Update State LastButton
            setState(statePathLastButton, currentButton);


            var stateValue = JSON.parse(getState(statePathClickHistory).val);
            if (! (lastButton == currentButton)) {
                stateValue.History = [];
            }else if (stateValue.History.length >= 1) {
                var milisecLastButtonPress =  stateValue.History[Math.max(stateValue.History.length - 1)];
                var milisecCurrentButtonPres = Date.now();
                console.log((milisecCurrentButtonPres - milisecLastButtonPress));
                if ((milisecCurrentButtonPres - milisecLastButtonPress) > 3000)  {
                    stateValue.History = [];
                }
            }

            if (stateValue.History.length >= maxArrayLength) {
                stateValue.History = [];
            }

            stateValue.History.push(Date.now());
            var buttonCounter = (stateValue.History.length - 1).toString();

            console.log(JSON.stringify(stateValue));
            setState(statePathClickHistory, JSON.stringify(stateValue));

            // Execute the button Action
            var buttonAction = buttonActionsMap[buttonCounter];
            if (buttonAction) {
                buttonAction.buttonAction();
            }
        };
        

        createState(statePathClickHistory, "{\"Event\":" + hueDimmerButtonId +",\"History\" : []}", () => {
            createState(statePathLastButton, getButtonFromButtonId(hueDimmerButtonId), registerEvents);
        });
    });
}

registerHueDimmerButtonEvents("A1", 'deconz.0.Sensors.2.buttonevent', {
    1000 : [
           {
                "buttonAction": () => {
                    console.log(0);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 254, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log(1);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 200, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log(2);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 175, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log(3);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 100, false, parseInt("0", 10), false);
                }
           },
           {
                "buttonAction": () => {
                    console.log(4);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 50, false, parseInt("0", 10), false);
                }
           },
    ],
    2002 : [
           {
                "buttonAction": () => {
                    console.log(0);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 100, false, parseInt("0", 10), false);
                }
           }
    ],
    3002 : [
           {
                "buttonAction": () => {
                    console.log(0);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 50, false, parseInt("0", 10), false);
                }
           }
    ],
    4002 : [
           {
                "buttonAction": () => {
                    console.log(0);
                    setStateDelayed('hue.0.Hue_01.Wohnzimmer.bri', 0, false, parseInt("0", 10), false);
                }
           }
    ],
});

