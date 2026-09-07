# Models

`face_detection_yunet_2023mar.onnx` - YuNet face detector from the OpenCV Zoo
(https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), Apache License 2.0.
Used by `autopub/images.py` to keep faces inside cover crops and to place the kicker and logo plate
away from them. 232 KB, runs on CPU through OpenCV's DNN module in a few milliseconds per photo.
