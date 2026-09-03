import time
import tkinter as tk
from tkinter import messagebox
import threading

def popup():
    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo("Prompt", "Hello! This prompt popped up after 10 seconds.")
    root.destroy()

print("Waiting for 10 seconds...")
time.sleep(10)
popup()
