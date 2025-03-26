
let sequenceNumber;
let timerInterval = 5; // 5ms tick for timer
let timer;

function timerRun() {
    timer++;
    if (timer == 4294967295) {
        timer = Math.floor(1000 * Math.random()); // reset timer to be within 32 bit size
    }
}

module.exports = {
    init: function () {
        timer = Math.floor(1000 * Math.random());
        setInterval(timerRun, timerInterval);
        sequenceNumber = Math.floor(1000 * Math.random());
    },

    getSequenceNumber: function () {
        sequenceNumber++;
        return sequenceNumber;
    },

    getTimestamp: function () {
        return timer;
    },

    getPeerID: function (IP, port) {
   
    },

    //Hex2Bin: convert Hex string into binary string
    Hex2Bin: function (hex) {
        var bin = ""
        hex.split("").forEach(str => {
            bin += parseInt(str, 16).toString(2).padStart(8, '0')
        })
        return bin
    },

    //XORing: finds the XOR of the two Binary Strings with the same size
    XORing: function (a, b){
    let ans = "";
        for (let i = 0; i < a.length ; i++)
        {
            // If the Character matches
            if (a[i] == b[i])
                ans += "0";
            else
                ans += "1";
        }
        return ans;
    }
};