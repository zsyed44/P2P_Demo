# P2P Demo Code:

To run, got to correct directory, and type the following command in terminal:
```
node DHTPeer -n server
```
To create a basic peer to act as the main peer/server

Tp add more peers, open up more terminals and run the following command:
```
node DHTPeer -n <name> -p 127.0.0.1:<port>
```

Where you can replace <name> with a name of your choice, and <port> number will be given when you generate a specific peer. You can only connect peers after the initial peer is made, after that you can connect peers to any new peer of your chosing, assuming you have the port numbers

Currently implementation of *heartbeat* is WIP.
