# tor-stealth-snowflake
Enable the Tor Snowflake without user Input.

# Setup
## Quick Way
<code><iframe src="https://nickwasused.github.io/tor-stealth-snowflake/" frameborder="0" height="0" width="0"></iframe></code>
  
## Manual Way
1. Download the tor folder
2. Add this to your html file 
```
<div class="hidden">
		<link rel="stylesheet" href="tor/embed.css" />
		<script src="tor/popup.js"></script>
		<script src="tor/embed.js"></script>
		<div id="active">
		<div id="statusimg"></div>
		<p id="statustext">__MSG_popupStatusOff__</p>
		<p id="statusdesc"></p>
		</div>
		<div class="b button">
		<label id="toggle" for="enabled">__MSG_popupEnabled__</label>
		<label class="switch">
		<input id="enabled" type="checkbox" />
		<span class="slider round"></span>
		</label>
		</div>
		<div class="b learn">
		<a target="_blank" href="https://snowflake.torproject.org/">__MSG_popupLearnMore__</a>
</div>
<script>
window.setTimeout(partA,5000);
console.log('Calling function in 5 Seconds');

function partA() {
	console.log('waiting for 3 seconds');
	var torbutton = document.getElementById("enabled");
	if (torbutton.checked == true){
		console.log('Snowflake is already enabled.');
		return;
	} else {
		console.log('Snowflake is not enabled.');
		window.setTimeout(partB,3000);
	}
	
}

function partB() {
	var torbutton = document.getElementById("enabled");
	torbutton.click(); // this will trigger the click event
	console.log('end of script');
};
</script>
```
